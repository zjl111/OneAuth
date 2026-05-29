package mailer

import (
	"crypto/tls"
	"errors"
	"fmt"
	"net"
	"net/smtp"
	"strconv"
	"strings"
	"time"

	"sso-server/internal/repository"
)

// Config SMTP 配置（从 sso_system_config 表实时加载）
type Config struct {
	Enabled       bool
	Host          string
	Port          int
	Username      string
	Password      string
	FromAddress   string
	FromName      string
	UseTLS        string // ssl | starttls | none
	ResetLinkBase string

	// 邮件模板
	SubjectPrefix string // 所有邮件主题前缀，如 "[OneAuth]"
	ResetSubject  string // 重置密码邮件主题
	ResetGreeting string // 重置密码邮件问候语
	ResetBody     string // 重置密码邮件正文模板（HTML，支持占位符 {{name}} {{link}}）
}

// Mailer 通过 ConfigRepo 动态读取配置，不持有静态字段，便于运营时改配置立即生效
type Mailer struct {
	cfg *repository.ConfigRepository
}

func New(cfg *repository.ConfigRepository) *Mailer { return &Mailer{cfg: cfg} }

// LoadConfig 从 DB 拉最新 smtp.* 配置
func (m *Mailer) LoadConfig() (*Config, error) {
	items, err := m.cfg.GetByCategory("smtp")
	if err != nil {
		return nil, err
	}
	c := &Config{UseTLS: "ssl", FromName: "OneAuth"}
	for _, it := range items {
		switch it.Key {
		case "enabled":
			c.Enabled = it.Value == "true"
		case "host":
			c.Host = strings.TrimSpace(it.Value)
		case "port":
			if v, err := strconv.Atoi(it.Value); err == nil {
				c.Port = v
			}
		case "username":
			c.Username = it.Value
		case "password":
			c.Password = it.Value
		case "from_address":
			c.FromAddress = it.Value
		case "from_name":
			c.FromName = it.Value
		case "use_tls":
			c.UseTLS = strings.ToLower(it.Value)
		case "reset_link_base":
			c.ResetLinkBase = strings.TrimRight(strings.TrimSpace(it.Value), "/")
		case "subject_prefix":
			c.SubjectPrefix = strings.TrimSpace(it.Value)
		case "reset_subject":
			c.ResetSubject = it.Value
		case "reset_greeting":
			c.ResetGreeting = it.Value
		case "reset_body":
			c.ResetBody = it.Value
		}
	}
	return c, nil
}

// Enabled 是否启用且必填项齐全
func (m *Mailer) Enabled() bool {
	c, err := m.LoadConfig()
	if err != nil {
		return false
	}
	return c.Enabled && c.Host != "" && c.Port > 0 && c.FromAddress != ""
}

// Send 发送一封 HTML 邮件
func (m *Mailer) Send(to []string, subject, htmlBody string) error {
	c, err := m.LoadConfig()
	if err != nil {
		return err
	}
	if !c.Enabled {
		return errors.New("SMTP 未启用")
	}
	if c.Host == "" || c.Port == 0 || c.FromAddress == "" {
		return errors.New("SMTP 配置不完整")
	}
	if len(to) == 0 {
		return errors.New("收件人为空")
	}

	from := c.FromAddress
	if c.FromName != "" {
		from = fmt.Sprintf("%s <%s>", c.FromName, c.FromAddress)
	}

	msg := buildMessage(from, to, subject, htmlBody)

	addr := fmt.Sprintf("%s:%d", c.Host, c.Port)
	var auth smtp.Auth
	if c.Username != "" {
		auth = smtp.PlainAuth("", c.Username, c.Password, c.Host)
	}

	switch c.UseTLS {
	case "ssl":
		return sendSSL(addr, c.Host, auth, c.FromAddress, to, msg)
	case "starttls":
		return sendSTARTTLS(addr, c.Host, auth, c.FromAddress, to, msg)
	default:
		return smtp.SendMail(addr, auth, c.FromAddress, to, msg)
	}
}

func buildMessage(from string, to []string, subject, htmlBody string) []byte {
	var b strings.Builder
	fmt.Fprintf(&b, "From: %s\r\n", from)
	fmt.Fprintf(&b, "To: %s\r\n", strings.Join(to, ", "))
	fmt.Fprintf(&b, "Subject: %s\r\n", encodeSubject(subject))
	b.WriteString("MIME-Version: 1.0\r\n")
	b.WriteString("Content-Type: text/html; charset=UTF-8\r\n")
	b.WriteString("Content-Transfer-Encoding: 8bit\r\n")
	fmt.Fprintf(&b, "Date: %s\r\n", time.Now().Format(time.RFC1123Z))
	b.WriteString("\r\n")
	b.WriteString(htmlBody)
	return []byte(b.String())
}

// encodeSubject 对中文 subject 使用 RFC 2047 base64 编码
func encodeSubject(s string) string {
	for _, r := range s {
		if r > 0x7F {
			return "=?UTF-8?B?" + base64Encode(s) + "?="
		}
	}
	return s
}

func base64Encode(s string) string {
	const tbl = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
	data := []byte(s)
	var out []byte
	for i := 0; i < len(data); i += 3 {
		var n uint32
		var pad int
		for j := 0; j < 3; j++ {
			n <<= 8
			if i+j < len(data) {
				n |= uint32(data[i+j])
			} else {
				pad++
			}
		}
		for k := 0; k < 4; k++ {
			if k < 4-pad {
				out = append(out, tbl[(n>>(18-6*k))&0x3F])
			} else {
				out = append(out, '=')
			}
		}
	}
	return string(out)
}

func sendSSL(addr, host string, auth smtp.Auth, from string, to []string, msg []byte) error {
	conn, err := tls.Dial("tcp", addr, &tls.Config{ServerName: host})
	if err != nil {
		return fmt.Errorf("tls dial: %w", err)
	}
	defer conn.Close()
	client, err := smtp.NewClient(conn, host)
	if err != nil {
		return fmt.Errorf("smtp client: %w", err)
	}
	defer client.Quit()
	if auth != nil {
		if err := client.Auth(auth); err != nil {
			return fmt.Errorf("auth: %w", err)
		}
	}
	return sendBody(client, from, to, msg)
}

func sendSTARTTLS(addr, host string, auth smtp.Auth, from string, to []string, msg []byte) error {
	conn, err := net.DialTimeout("tcp", addr, 15*time.Second)
	if err != nil {
		return fmt.Errorf("dial: %w", err)
	}
	client, err := smtp.NewClient(conn, host)
	if err != nil {
		_ = conn.Close()
		return fmt.Errorf("smtp client: %w", err)
	}
	defer client.Quit()
	if ok, _ := client.Extension("STARTTLS"); ok {
		if err := client.StartTLS(&tls.Config{ServerName: host}); err != nil {
			return fmt.Errorf("starttls: %w", err)
		}
	}
	if auth != nil {
		if err := client.Auth(auth); err != nil {
			return fmt.Errorf("auth: %w", err)
		}
	}
	return sendBody(client, from, to, msg)
}

func sendBody(client *smtp.Client, from string, to []string, msg []byte) error {
	if err := client.Mail(from); err != nil {
		return fmt.Errorf("mail from: %w", err)
	}
	for _, addr := range to {
		if err := client.Rcpt(addr); err != nil {
			return fmt.Errorf("rcpt %s: %w", addr, err)
		}
	}
	w, err := client.Data()
	if err != nil {
		return fmt.Errorf("data: %w", err)
	}
	if _, err := w.Write(msg); err != nil {
		return fmt.Errorf("write: %w", err)
	}
	return w.Close()
}
