// Package captcha 提供"滑动拼图"图形验证码：
//   - FetchImage：优先 Unsplash，失败/未配置 key 时回退到嵌入的 5 张本地图
//   - MakePuzzle：把一张大图切出"带缺口的背景"和"对应位置的拼图块"两张图
//   - Service：负责生成 challenge / 校验拖动结果 / 签发一次性 ticket
//
// challenge / ticket 全部存在 oauth.Store 里（Redis 或内存），TTL 短不会膨胀。
package captcha

import (
	"bytes"
	"context"
	"crypto/rand"
	"embed"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"image"
	"image/color"
	"image/draw"
	"image/jpeg"
	"image/png"
	"io"
	"math/big"
	"net/http"
	"time"

	"sso-server/internal/oauth"
)

//go:embed assets/*.jpg
var fallbackFS embed.FS

const (
	// 最终输出尺寸：背景固定 320x180（16:9）方便前端布局
	bgW = 320
	bgH = 180
	// 拼图块尺寸
	pieceW = 50
	pieceH = 50
	// 拼图块在 Y 方向居中（180-50)/2 = 65
	pieceY = 65

	challengeTTL = 60 * time.Second
	ticketTTL    = 30 * time.Second

	// 容差：用户拖动到的位置和真实缺口位置的误差像素数
	matchTolerance = 6
	// 反脚本：拖动总耗时下限（毫秒）。低于这个肯定是脚本秒拖。
	minDragDurationMs = 250
)

// Service 主入口
type Service struct {
	Store      oauth.Store
	HTTPClient *http.Client
	// KeyProvider 返回当前生效的 Unsplash Access Key（从系统设置读，可热更）
	KeyProvider func() string
}

func New(store oauth.Store, keyProvider func() string) *Service {
	return &Service{
		Store:       store,
		HTTPClient:  &http.Client{Timeout: 5 * time.Second},
		KeyProvider: keyProvider,
	}
}

// Challenge 是发给前端的 challenge 描述。
type Challenge struct {
	ID         string `json:"challenge_id"`
	Background string `json:"bg"`     // data:image/png;base64,...
	Piece      string `json:"piece"`  // data:image/png;base64,...
	PieceY     int    `json:"piece_y"`

	// Unsplash 署名（fallback 本地图时为空）
	// 按 Unsplash API Guidelines 必须显示：Photo by <PhotographerName> on Unsplash
	// 链接需带 utm_source=oneauth&utm_medium=referral
	PhotographerName string `json:"photographer_name,omitempty"`
	PhotographerURL  string `json:"photographer_url,omitempty"`
	UnsplashURL      string `json:"unsplash_url,omitempty"`
}

type challengeState struct {
	ExpectX   int   `json:"x"`
	CreatedAt int64 `json:"t"`
}

// unsplashPhoto 描述一张拉到的图 + 作者署名（用于按 Unsplash Guidelines 在前端展示）。
type unsplashPhoto struct {
	Image            image.Image
	PhotographerName string
	PhotographerURL  string
	UnsplashURL      string
}

// Generate 拉一张图 → 切拼图 → 存 expect X → 返回 base64
func (s *Service) Generate(ctx context.Context) (*Challenge, error) {
	src, photo, err := s.fetchImage(ctx)
	if err != nil {
		return nil, err
	}
	bgImg, pieceImg, expectX := makePuzzle(src)
	id := randHex(16)
	st := challengeState{ExpectX: expectX, CreatedAt: time.Now().Unix()}
	raw, _ := json.Marshal(st)
	if err := s.Store.Set(ctx, "captcha:ch:"+id, raw, challengeTTL); err != nil {
		return nil, err
	}
	ch := &Challenge{
		ID:         id,
		Background: pngDataURL(bgImg),
		Piece:      pngDataURL(pieceImg),
		PieceY:     pieceY,
	}
	if photo != nil {
		ch.PhotographerName = photo.PhotographerName
		ch.PhotographerURL = photo.PhotographerURL
		ch.UnsplashURL = photo.UnsplashURL
	}
	return ch, nil
}

// Verify 校验拖动结果，通过则签发一次性 ticket，30s 内可用。
//   - id: challenge_id
//   - x: 用户拖到的 x 坐标
//   - durationMs: 用户拖动耗时（前端测量）
func (s *Service) Verify(ctx context.Context, id string, x int, durationMs int) (string, error) {
	if id == "" {
		return "", errors.New("missing challenge_id")
	}
	raw, err := s.Store.Get(ctx, "captcha:ch:"+id)
	if err != nil || len(raw) == 0 {
		return "", errors.New("challenge expired")
	}
	// 一次性：先删，免重放
	_ = s.Store.Del(ctx, "captcha:ch:"+id)
	var st challengeState
	if err := json.Unmarshal(raw, &st); err != nil {
		return "", errors.New("challenge corrupted")
	}
	if durationMs < minDragDurationMs {
		return "", errors.New("drag too fast")
	}
	if abs(x-st.ExpectX) > matchTolerance {
		return "", errors.New("position mismatch")
	}
	ticket := randHex(24)
	_ = s.Store.Set(ctx, "captcha:ticket:"+ticket, []byte("1"), ticketTTL)
	return ticket, nil
}

// ConsumeTicket 在登录请求时消费 ticket（一次性）。
func (s *Service) ConsumeTicket(ctx context.Context, ticket string) bool {
	if ticket == "" {
		return false
	}
	v, err := s.Store.Get(ctx, "captcha:ticket:"+ticket)
	if err != nil || len(v) == 0 {
		return false
	}
	_ = s.Store.Del(ctx, "captcha:ticket:"+ticket)
	return true
}

// fetchImage：优先走 Unsplash，失败回退本地。永远返回 320x180 RGBA。
// 第二个返回值是 Unsplash 的署名信息；本地兜底时为 nil。
func (s *Service) fetchImage(ctx context.Context) (image.Image, *unsplashPhoto, error) {
	if key := s.keyOrEmpty(); key != "" {
		if photo, err := s.fetchUnsplash(ctx, key); err == nil {
			return resizeCrop(photo.Image, bgW, bgH), photo, nil
		}
		// Unsplash 失败：静默回退本地，不打断登录页加载
	}
	img, err := loadFallback()
	if err != nil {
		return nil, nil, err
	}
	return resizeCrop(img, bgW, bgH), nil, nil
}

func (s *Service) keyOrEmpty() string {
	if s.KeyProvider == nil {
		return ""
	}
	return s.KeyProvider()
}

// fetchUnsplash 拉一张图 + 作者署名。按 Unsplash API Guidelines:
//   1. 用 /photos/random 拿到图的 download_location
//   2. 下载图片之前，先 GET 一次 download_location（这是 Unsplash 统计下载量的方式）
//   3. 在前端展示 "Photo by <name> on Unsplash"
//   4. 链接带 utm_source=oneauth&utm_medium=referral
func (s *Service) fetchUnsplash(ctx context.Context, key string) (*unsplashPhoto, error) {
	topics := []string{"nature", "architecture", "textures-patterns"}
	t := topics[randIntN(len(topics))]
	url := fmt.Sprintf("https://api.unsplash.com/photos/random?orientation=landscape&topics=%s", t)
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	req.Header.Set("Authorization", "Client-ID "+key)
	req.Header.Set("Accept-Version", "v1")
	resp, err := s.HTTPClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("unsplash %d", resp.StatusCode)
	}
	var meta struct {
		Links struct {
			HTML             string `json:"html"`
			DownloadLocation string `json:"download_location"`
		} `json:"links"`
		URLs struct {
			Small string `json:"small"`
		} `json:"urls"`
		User struct {
			Name  string `json:"name"`
			Links struct {
				HTML string `json:"html"`
			} `json:"links"`
		} `json:"user"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&meta); err != nil {
		return nil, err
	}
	if meta.URLs.Small == "" {
		return nil, errors.New("unsplash empty url")
	}

	// Step 1: trigger download_location（异步、失败不影响主流程；Unsplash 文档要求"在下载前"调）
	if meta.Links.DownloadLocation != "" {
		go func(loc, k string) {
			tCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			r, _ := http.NewRequestWithContext(tCtx, http.MethodGet, loc, nil)
			r.Header.Set("Authorization", "Client-ID "+k)
			r.Header.Set("Accept-Version", "v1")
			if resp, err := s.HTTPClient.Do(r); err == nil {
				_, _ = io.Copy(io.Discard, resp.Body)
				resp.Body.Close()
			}
		}(meta.Links.DownloadLocation, key)
	}

	// Step 2: 真正下载图片
	imgReq, _ := http.NewRequestWithContext(ctx, http.MethodGet, meta.URLs.Small, nil)
	imgResp, err := s.HTTPClient.Do(imgReq)
	if err != nil {
		return nil, err
	}
	defer imgResp.Body.Close()
	if imgResp.StatusCode != 200 {
		return nil, fmt.Errorf("unsplash img %d", imgResp.StatusCode)
	}
	body, _ := io.ReadAll(io.LimitReader(imgResp.Body, 4*1024*1024))
	img, _, err := image.Decode(bytes.NewReader(body))
	if err != nil {
		return nil, err
	}

	// Step 3: 拼接带 UTM 的署名链接
	const utm = "?utm_source=oneauth&utm_medium=referral"
	return &unsplashPhoto{
		Image:            img,
		PhotographerName: meta.User.Name,
		PhotographerURL:  meta.User.Links.HTML + utm,
		UnsplashURL:      meta.Links.HTML + utm,
	}, nil
}

func loadFallback() (image.Image, error) {
	idx := randIntN(5) + 1
	f, err := fallbackFS.Open(fmt.Sprintf("assets/%d.jpg", idx))
	if err != nil {
		return nil, err
	}
	defer f.Close()
	return jpeg.Decode(f)
}

// makePuzzle 在 src 上随机选一个 X 位置，"挖出"一个矩形拼图块；
// 返回带缺口的背景图、对应的拼图块图、缺口的 X 坐标。
//
// 简化版：用矩形缺口而不是复杂凸凹拼图形状，前端拖到位即可。
// 反脚本靠 拖动时长 + 失败次数 兜底，不依赖图形复杂度。
func makePuzzle(src image.Image) (*image.RGBA, *image.RGBA, int) {
	src = resizeCrop(src, bgW, bgH)
	// 缺口 X 范围：避免出现在最左/最右（拖动距离需有意义）
	xMin := pieceW + 20
	xMax := bgW - pieceW - 10
	expectX := xMin + randIntN(xMax-xMin)

	bg := image.NewRGBA(image.Rect(0, 0, bgW, bgH))
	draw.Draw(bg, bg.Bounds(), src, image.Point{}, draw.Src)

	piece := image.NewRGBA(image.Rect(0, 0, pieceW, pieceH))
	pieceRect := image.Rect(expectX, pieceY, expectX+pieceW, pieceY+pieceH)
	// 把背景对应区域复制到 piece
	draw.Draw(piece, piece.Bounds(), src, pieceRect.Min, draw.Src)

	// 在背景上把缺口涂成半透明黑色（让用户能看到缺口位置）
	shadow := color.RGBA{0, 0, 0, 140}
	for y := pieceRect.Min.Y; y < pieceRect.Max.Y; y++ {
		for x := pieceRect.Min.X; x < pieceRect.Max.X; x++ {
			bg.Set(x, y, shadow)
		}
	}
	// 给 piece 加白色边框，让它在登录页上更显眼
	border := color.RGBA{255, 255, 255, 255}
	for x := 0; x < pieceW; x++ {
		piece.Set(x, 0, border)
		piece.Set(x, pieceH-1, border)
	}
	for y := 0; y < pieceH; y++ {
		piece.Set(0, y, border)
		piece.Set(pieceW-1, y, border)
	}
	return bg, piece, expectX
}

// resizeCrop 把任意尺寸图缩到 w*h（中心裁剪）；不引入额外依赖，用最近邻足够了。
func resizeCrop(src image.Image, w, h int) image.Image {
	sb := src.Bounds()
	srcW, srcH := sb.Dx(), sb.Dy()
	// 先按"覆盖"比例缩放（取较大缩放比），再中心裁剪
	scaleW := float64(w) / float64(srcW)
	scaleH := float64(h) / float64(srcH)
	scale := scaleW
	if scaleH > scale {
		scale = scaleH
	}
	scaledW := int(float64(srcW) * scale)
	scaledH := int(float64(srcH) * scale)
	scaled := image.NewRGBA(image.Rect(0, 0, scaledW, scaledH))
	for y := 0; y < scaledH; y++ {
		sy := int(float64(y) / scale)
		if sy >= srcH {
			sy = srcH - 1
		}
		for x := 0; x < scaledW; x++ {
			sx := int(float64(x) / scale)
			if sx >= srcW {
				sx = srcW - 1
			}
			scaled.Set(x, y, src.At(sb.Min.X+sx, sb.Min.Y+sy))
		}
	}
	// 中心裁剪
	offX := (scaledW - w) / 2
	offY := (scaledH - h) / 2
	out := image.NewRGBA(image.Rect(0, 0, w, h))
	draw.Draw(out, out.Bounds(), scaled, image.Point{X: offX, Y: offY}, draw.Src)
	return out
}

func pngDataURL(img image.Image) string {
	var buf bytes.Buffer
	_ = png.Encode(&buf, img)
	return "data:image/png;base64," + base64.StdEncoding.EncodeToString(buf.Bytes())
}

func randHex(n int) string {
	b := make([]byte, n)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

func randIntN(n int) int {
	if n <= 0 {
		return 0
	}
	v, err := rand.Int(rand.Reader, big.NewInt(int64(n)))
	if err != nil {
		return 0
	}
	return int(v.Int64())
}

func abs(x int) int {
	if x < 0 {
		return -x
	}
	return x
}
