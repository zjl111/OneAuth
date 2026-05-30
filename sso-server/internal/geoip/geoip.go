// Package geoip 基于 ip2region xdb 的离线 IP -> 省份 解析。
package geoip

import (
	"log"
	"net"
	"strings"
	"sync"

	"github.com/lionsoul2014/ip2region/binding/golang/xdb"
)

var (
	vIndex []byte
	dbFile string
	once   sync.Once
	mu     sync.Mutex
)

// Init 加载 vector index；后续每次 Lookup 内部短期新建一个 searcher。
func Init(path string) error {
	var err error
	once.Do(func() {
		v, e := xdb.LoadVectorIndexFromFile(path)
		if e != nil {
			err = e
			return
		}
		vIndex = v
		dbFile = path
		log.Printf("[geoip] xdb loaded: %s (vector index %d bytes)", path, len(v))
	})
	return err
}

// trimChinaSuffix 去掉「省/市/自治区/特别行政区」后缀，方便和前端 china.json 名称匹配
func trimChinaSuffix(s string) string {
	suffixes := []string{"维吾尔自治区", "壮族自治区", "回族自治区", "特别行政区", "自治区", "省", "市"}
	for _, suf := range suffixes {
		if strings.HasSuffix(s, suf) {
			return strings.TrimSuffix(s, suf)
		}
	}
	return s
}

// LookupProvince 返回省份名（无后缀，例如 "北京" / "广东" / "重庆"）。
// 私网/本地/无法解析时返回 ""，调用方自行决定如何展示。
func LookupProvince(ip string) string {
	p, _, _ := Lookup(ip)
	return p
}

// Lookup 同时返回 (省, 市, 运营商)。私网 / 解析失败时各字段为空。
// 直辖市（北京/上海/天津/重庆）的"市"自动 fallback 为同名，方便前端列展示。
func Lookup(ip string) (province, city, isp string) {
	if vIndex == nil || ip == "" {
		return
	}
	parsed := net.ParseIP(ip)
	if parsed == nil || parsed.IsLoopback() || parsed.IsPrivate() {
		return
	}
	mu.Lock()
	searcher, err := xdb.NewWithVectorIndex(xdb.IPv4, dbFile, vIndex)
	mu.Unlock()
	if err != nil {
		return
	}
	defer searcher.Close()
	region, err := searcher.Search(ip)
	if err != nil || region == "" {
		return
	}
	// ip2region 格式: 国家|区域|省份|城市|ISP
	parts := strings.Split(region, "|")
	if len(parts) < 5 {
		return
	}
	country := parts[0]
	if country != "" && country != "中国" && country != "0" {
		return // 暂只统计国内
	}
	province = clean(parts[2])
	city = clean(parts[3])
	isp = clean(parts[4])
	// 部分 IP 库会把直辖市的省份位留 0，仅写城市；反过来归位到省份字段
	if province == "" && city != "" && isMunicipality(city) {
		province = city
	}
	// 直辖市市级名称与省同名时，市级显示同名（北京/北京、上海/上海……）
	if province != "" && city == "" && isMunicipality(province) {
		city = province
	}
	return trimChinaSuffix(province), trimChinaSuffix(city), isp
}

func clean(s string) string {
	if s == "" || s == "0" {
		return ""
	}
	return s
}

func isMunicipality(name string) bool {
	switch trimChinaSuffix(name) {
	case "北京", "上海", "天津", "重庆":
		return true
	}
	return false
}
