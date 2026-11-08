# Staff & Tenant Home — Typography and feature alignment

Ngày: 07/11/2026, Asia/Bangkok. Áp dụng yêu cầu chuẩn hóa typography và attachment Fix Tenant Feature Card Alignment to Match Staff UI. Không đổi API, navigation, business logic hoặc cấu trúc dashboard. Staff chỉ đổi typography; geometry card được trích nguyên sang style chung.

## 1. Nguồn kiểm tra

- `app/_layout.tsx`: useFonts đăng ký Inter-Regular, Inter-Medium, Inter-SemiBold, Inter-Bold từ bốn TTF local, trước PaperProvider. Không có font map riêng cho Staff/Tenant hoặc platform.
- `theme/theme.ts`: configureFonts của React Native Paper; cấu hình các variant nhưng trước lượt này chưa override default và chưa chỉ định fontWeight/letterSpacing.
- `react-native-paper/src/styles/fonts.tsx`, `styles/themes/v3/tokens.tsx`, `components/Typography/Text.tsx`: configureFonts merge vào MD3 tokens; Text không có variant dùng fonts.default; style truyền vào có thể override variant.
- StaffDashboard, DashboardKit, StaffFeatureCard, StaffFeatureDirectory, TenantDashboard, TenantFeatureDirectory và WorkspaceShell.
- [Expo SDK 58 Font documentation](https://docs.expo.dev/versions/v58.0.0/sdk/font/): đối chiếu cơ chế runtime font map hiện có trên Android/iOS/web. Không cài font library hoặc thay cơ chế native bundling.

## 2. Cấu hình trước khi sửa

Thứ tự các giá trị dưới đây: **fontFamily / fontSize / fontWeight style / lineHeight / letterSpacing**. Font weight là giá trị style được merge từ Paper, không phải tuyên bố về kết quả pixel hoặc độ đậm vật lý của file.

Staff Home:

- Greeting: Inter-SemiBold / 20 / 400 / 28 / 0 (`headlineSmall`).
- Metric count: Inter-Bold / 24 / 400 / 32 / 0 (`headlineMedium`). Đây là số lượng, không phải tiền.
- Section heading: Inter-SemiBold / 14 / 500 / 20 / 0.15 (`titleMedium`).
- Feature title: Inter-SemiBold / 13 / 600 / 18 / 0.15. Component override size/weight/height, giữ family/tracking từ titleMedium.
- Feature description: Inter-Regular / 12 / 400 / 17 / 0.4 (`bodySmall` + style).
- Priority title: Inter-SemiBold / 12 / 500 / 16 / 0.1 (`titleSmall`).
- Body/location: Inter-Regular / 13 / 400 / 18 / 0.4 (`bodySmall`).
- Caption/status labelSmall: Inter-Medium / 11 / 500 / 14 / 0.5.
- Metric label không có variant/family: font mặc định platform / 11 / 400 / 16 / 0.

Tenant Home và feature catalog:

- Room title: Inter-Bold / 24 / 400 / 32 / 0.
- Section heading: Inter-SemiBold / 16 / 400 / 22 / 0.
- Card/Home feature title: Inter-SemiBold / 14 / 400 / 20 / 0.
- All Features title: Inter-SemiBold / 13 / 400 / 18 / 0.
- Link row: Inter-Medium / 13 / 400 / 20 / 0.
- Secondary và error không có fontFamily/variant: font mặc định platform / 12 / 400 / 18 / 0.
- Contract status: font mặc định platform / 12 / 400 / 18 / 0.
- Badge: Inter-Medium / 11 / 400 / 16 / 0.
- Important amount: Inter-Bold / 30 / 400 / 40 / 0.
- Utility value: Inter-SemiBold / 24 / 400 / 32 / 0.

Header/navigation liên quan:

- Staff brand dùng titleLarge: Inter-SemiBold / 17 / 400 / 24 / 0.
- Compact Tenant brand dùng titleMedium: Inter-SemiBold / 14 / 500 / 20 / 0.15.
- Subtitle header dùng labelSmall: Inter-Medium / 11 / 500 / 14 / 0.5.
- Bottom labels không chỉ định family: default platform / 11 / 700 hoặc 500 / 14 / 0.

“Font mặc định platform” ở Paper MD3 là System trên iOS, sans-serif trên Android, và chuỗi Roboto/Helvetica/Arial trên web. Hai role **không chủ ý dùng hai bộ font khác nhau**; sự khác biệt phát sinh từ variant, style inline và default slot chưa được cấu hình.

Các điểm lệch chính: section 14 so với 16; card 13 so với 14; description line-height 17/18; tracking 0.1–0.5 so với 0; style weight 600 chồng lên file SemiBold; text không có family có thể dùng system fallback. Không có bằng chứng device để gọi đây là lỗi fallback đã tái hiện trên Android/iOS.

## 3. Chuẩn áp dụng

`theme/typography.ts` là semantic scale dùng chung, reuse đúng bốn alias hiện có:

- Screen title: Inter-Bold, 24/32.
- Section heading: Inter-SemiBold, 16/22.
- Card title: Inter-SemiBold, 14/20.
- Body: Inter-Regular, 13/20.
- Secondary: Inter-Regular, 12/18.
- Small status: Inter-Medium, 11/16; status/label cần lớn hơn dùng 12/18.
- Link/action text: Inter-Medium, 13/20.
- Important money: Inter-Bold, 30/40, tabular digits.
- Nonfinancial count: Inter-Bold, 24/32; utility value Inter-SemiBold 24/32. Không phóng mọi con số lên bằng tiền.

Tất cả role tokens chỉ định letterSpacing=0 và fontWeight='normal'. Đây là quy ước **static face**: file được chọn đã có outline weight Regular=400, Medium=500, SemiBold=600, Bold=700; không yêu cầu thêm một weight tổng hợp lên alias. `normal` không có nghĩa bỏ font Bold: screen title/money vẫn chọn Inter-Bold.ttf.

Theme Paper tiếp tục là entrypoint toàn app. Default/display slots kế thừa Inter-Regular thay vì system. Các variant size/line-height đang khai báo trong theme được giữ nguyên để tránh đổi kích thước các màn khác; chuẩn hóa family/weight/tracking, và Home dùng semantic tokens cho đúng hierarchy. Đây là thay đổi shared font defaults có tác động tới text Paper ngoài Home; full mobile regression và web bundle đã chạy, chưa phải kiểm chứng trực quan toàn app.

Header brand giữ hierarchy compact riêng từng layout; bottom labels chọn đúng Inter-SemiBold/Inter-Medium thay vì yêu cầu fontWeight 700/500 trên default family. Không đổi kích thước hay hành vi tabs.

## 4. Thẻ chức năng Tenant

- Trích geometry nguyên từ StaffFeatureCard thành FeatureCardLayout: radius 18, shadow cũ, padding 12, compact gap 4, icon 36×36 radius 12, glyph 22; giữ nguyên geometry Staff, kể cả biến thể incident.
- Tenant dùng cùng geometry, màu xanh/light-blue hiện có; wrapper alignItems=center và justifyContent=center, icon wrapper căn giữa cả hai trục; title textAlign=center. Không dùng absolute position hoặc margin trái để giả căn giữa.
- Home và All Features tiếp tục hai cột, gap 12. Toàn bộ 11 feature dùng một renderer, cùng chiều cao 112; hai dòng title 14/20 có đủ chỗ cùng icon/padding. Danh mục trước đây 104px được đồng nhất 112px để tránh cắt title sau chuẩn hóa chữ.
- Không thêm subtitle/description mới vào Tenant chỉ để lấp khoảng trống. Staff description đang có vẫn căn giữa, dùng Secondary 12/18. Nội dung không có subtitle vẫn căn giữa cả nhóm.
- Không đổi thứ tự, title/icon, trạng thái khả dụng hoặc handler/params của feature. Không sửa thông tin invoice/room ngoài typography.

## 5. Files thay đổi trong lượt này

- `src/mobile/src/theme/typography.ts` (mới): alias/semantic tokens/helper cho static face.
- `src/mobile/src/theme/theme.ts`: reuse tokens, chuẩn hóa Paper defaults và variant weights/tracking.
- `src/mobile/src/components/FeatureCardLayout.ts` (mới): geometry Staff được dùng chung.
- `src/mobile/src/components/StaffFeatureCard.tsx`: reuse geometry, card/description/status typography; không đổi navigation/props hay layout Staff.
- `src/mobile/src/components/TenantFeatureDirectory.tsx`: wrapper/icon/title căn giữa; reuse geometry và typography cho mọi tile, giữ grid/destination.
- `src/mobile/src/components/DashboardKit.tsx`: summary/heading/status dùng semantic scale.
- `src/mobile/src/screens/StaffDashboard.tsx`: chỉ text styles; không đổi data, bố cục hay handler.
- `src/mobile/src/screens/TenantDashboard.tsx`: chỉ thay style chữ bằng shared tokens, giữ nội dung/thứ tự/bố cục.
- `src/mobile/src/components/WorkspaceShell.tsx`: chỉ font face/weight/tracking của bottom labels.
- `src/mobile/src/__tests__/home-typography.test.tsx` (mới): kiểm tra Paper defaults, hierarchy, geometry/font Tenant so với Staff, actual TTF weights và glyph tiếng Việt.
- Báo cáo này. Không sửa font assets, package dependencies, backend, API, route hoặc database.

## 6. Font loading và tiếng Việt

`app/_layout.tsx` vẫn đăng ký cùng bốn font bằng useFonts trên mọi platform. Không thêm Platform.select cho alias hoặc font family khác giữa Staff/Tenant. App chờ load trong trường hợp thông thường; nhánh font loading error hiện có vẫn cho app tiếp tục, nên không tuyên bố asset luôn load thành công trên mọi thiết bị.

Test đọc trực tiếp OS/2/cmap của cả bốn TTF, xác nhận usWeightClass 400/500/600/700 và glyph nonzero cho ĂăĐđƠơƯư, toàn dải U+1EA0–U+1EF9 và các dấu kết hợp grave/acute/circumflex/tilde/breve/hook/horn/dot below. Không cài thư viện kiểm font mới. Đây là bằng chứng font chứa glyph, không thay thế kiểm chứng shaping/rasterization trên điện thoại.

## 7. Kiểm chứng

```powershell
npm run test --workspace ./src/mobile -- src/__tests__/home-typography.test.tsx src/__tests__/staff-dashboard.test.tsx ../../tests/mobile/ocr/liveWorkspace-ui.test.tsx src/__tests__/workspace-navigation.test.tsx
npm run lint --workspace ./src/mobile
npm run typecheck --workspace ./src/mobile
```

- Targeted: **4 file, 126 test qua** sau sửa đường dẫn đọc font trong test. Không có assertion glyph/weight fail ở kết quả cuối.
- Lint, TypeScript, Prettier và git diff --check: **qua**.
- Full mobile với Node 22.23.4: **644 test qua, 57 file qua; một suite không tải được**. `tests/mobile/ocr/meterScreen.test.tsx` vẫn mock thiếu MD3LightTheme như các lượt trước; không gọi cả suite PASS.
- Web export ứng dụng thật: **qua**, `.tools/home-typography-web` ignored artifact.
- Các test mới xác nhận mọi Tenant icon/group/title căn giữa theo props/styles, dùng cùng kích thước/font với Staff compact reference; không phải screenshot/pixel test.

Chưa chạy Android/iOS thật, font scaling lớn hoặc pixel comparison. UI host/native pipe đã unavailable trong lượt trước; không có ảnh thiết bị mới. Không claim E2E/API/provider verification. Chưa commit/push và giữ nguyên các thay đổi chưa commit của các lượt trước.
