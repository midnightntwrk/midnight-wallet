# Midnight Wallet SDK - Tổng Quan Dự Án và PDR

## Tổng Quan Dự Án

### Tên & Mục Đích
**Midnight Wallet SDK** là triển khai TypeScript của [Midnight Wallet Specification](https://github.com/midnightntwrk/midnight-architecture/blob/main/components/WalletEngine/Specification.md). Đây là thư viện SDK hoàn chỉnh cho phép các nhà phát triển xây dựng ứng dụng ví điện tử trên Midnight Network.

### Tính Chất Dự Án
- **Trạng Thái:** Beta (v1.0.0-beta.x)
- **Kiến Trúc:** Monorepo TypeScript sử dụng Yarn Workspaces + Turborepo
- **Ngôn Ngữ:** TypeScript 5.9+, JavaScript (ESNext)
- **Runtime:** Node.js v20+
- **Giấy Phép:** Apache 2.0

## Các Tính Năng & Khả Năng Chính

### Tính Năng Lõi
1. **Quản lý Chìa Khóa & Địa Chỉ**
   - Tạo và dẫn xuất chìa khóa qua HD-Wallet (BIP32/BIP39)
   - Mã hóa địa chỉ Bech32m cho các loại tài khoản khác nhau

2. **Quản lý Trạng Thái Ví**
   - Quản lý UTXO (Unspent Transaction Output)
   - Theo dõi số dư tài khoản (khả dụng, tổng, đang chờ xử lý)
   - Đồng bộ hóa trạng thái với Indexer

3. **Xây Dựng & Gửi Giao Dịch**
   - Xây dựng giao dịch với các đầu vào/đầu ra tùy chỉnh
   - Chọn coin thông minh (balancing capability)
   - Gửi giao dịch đến node Midnight

4. **Chứng Minh Zk & Bảo Mật**
   - Tương tác với Proof Server để tạo chứng minh
   - Hỗ trợ giao dịch riêng tư trên ví shielded

5. **Hỗ Trợ Đa Phiên Bản**
   - Hỗ trợ các phiên bản giao thức khác nhau (v1, v2, ...)
   - Chuyển đổi trạng thái liền mạch khi hard-fork

## Người Dùng Mục Tiêu

### Nhà Phát Triển Ứng Dụng
- Xây dựng ứng dụng ví cho Midnight Network
- Tích hợp chức năng ví vào dApp
- Phát triển các dịch vụ tài chính trên Midnight

### Nhà Phát Triển Cơ Sở Hạ Tầng
- Tích hợp hệ thống thanh toán
- Tạo các công cụ CLI quản lý ví
- Phát triển các giải pháp lưu trữ khóa

## Yêu Cầu Kỹ Thuật

### Yêu Cầu Hệ Thống
- **Node.js:** v20 hoặc cao hơn
- **Yarn:** 4.10.3 hoặc tương thích
- **TypeScript:** 5.9.3+
- **Hệ điều hành:** Linux, macOS, Windows (MINGW64)

### Yêu Cầu Cơ Sở Hạ Tầng (tùy chọn)
- **Indexer:** Midnight Indexer (3.0.0-alpha+) - để đồng bộ trạng thái
- **Node Midnight:** Midnight Node (0.18.0-rc+) - để gửi giao dịch
- **Proof Server:** Midnight Proof Server (6.1.0-alpha+) - để tạo chứng minh
- **Docker & Docker Compose:** Để chạy cơ sở hạ tầng cục bộ

### Phụ Thuộc Chính
```json
{
  "effect": "^3.17.3",
  "rxjs": "^7.5",
  "@midnight-ntwrk/ledger-v6": "6.1.0-alpha.6"
}
```

## Tiêu Chí Thành Công

### Chức Năng
- [ ] Tạo & quản lý các ví shielded/unshielded
- [ ] Xây dựng giao dịch với các loại token khác nhau
- [ ] Gửi giao dịch và theo dõi trạng thái
- [ ] Đồng bộ hóa trạng thái tự động từ Indexer
- [ ] Chuyển đổi trạng thái giữa các phiên bản giao thức

### Hiệu Suất
- Xây dựng giao dịch < 100ms
- Đồng bộ trạng thái realtime
- Hỗ trợ nhiều ví đồng thời

### Độ Tin Cậy
- Không mất dữ liệu giao dịch
- Khôi phục trạng thái đầy đủ từ lưu trữ
- Xử lý lỗi cơ sở hạ tầng graceful

### Tính Bảo Mật
- Không lưu trữ chìa khóa riêng trên server
- Sử dụng Ledger v6 cho hoạt động mật mã
- Hỗ trợ xác minh chứng minh Zk

## Cấu Trúc Thư Mục

```
nocturne-midnight-wallet/
├── packages/                 # Monorepo packages
│   ├── abstractions/        # Core type contracts
│   ├── runtime/             # Variant orchestration
│   ├── facade/              # Unified wallet API
│   ├── shielded-wallet/     # V1 shielded variant
│   ├── unshielded-wallet/   # Public wallet
│   ├── dust-wallet/         # Testing wallet
│   ├── address-format/      # Bech32m encoding
│   ├── hd/                  # HD-Wallet (BIP32/39)
│   ├── capabilities/        # Balancing & selection
│   ├── indexer-client/      # GraphQL sync
│   ├── node-client/         # Polkadot API
│   ├── prover-client/       # HTTP proof service
│   ├── unshielded-state/    # UTXO state mgmt
│   ├── utilities/           # Common operations
│   ├── e2e-tests/           # End-to-end tests
│   └── wallet-integration-tests/  # Integration tests
├── docs/                     # Documentation
├── .claude/                  # Claude Code workflows
└── docker-compose.yml        # Local infrastructure
```

## Trạng Thái Hiện Tại

### Phiên Bản Beta
- Tất cả packages đang ở phiên bản beta (v1.0.0-beta.x)
- API có thể thay đổi trước phiên bản ổn định
- Đang tích cực phát triển và kiểm thử

### Mạng Hỗ Trợ
- MainNet
- TestNet
- DevNet
- QaNet
- Preview
- PreProd
- Undeployed

### Công Nghệ Stack
- **Orchestration:** Turborepo
- **Package Manager:** Yarn Workspaces
- **Testing:** Vitest + Allure Reporting
- **Linting:** ESLint 9 + Prettier
- **Type System:** TypeScript 5.9 + Effect.js
- **Async:** RxJS 7 + Effect.js
- **CI/CD:** GitHub Actions (11 workflows)

## Yêu Cầu Phát Triển (PDR)

### PDR-001: Hỗ Trợ Đa Ví
**Mục Tiêu:** Một ứng dụng có thể quản lý nhiều ví của các loại khác nhau.
- **Chỉ Tiêu Chấp Nhận:** Facade hỗ trợ tạo/chuyển đổi giữa ≥3 ví
- **Chu Kỳ:** Q1 2025

### PDR-002: Đồng Bộ Realtime
**Mục Tiêu:** Ví tự động cập nhật trạng thái từ blockchain.
- **Chỉ Tiêu Chấp Nhận:** Latency < 2 giây, 99.9% uptime
- **Chu Kỳ:** Q1 2025

### PDR-003: Chuyển Đổi Trạng Thái
**Mục Tiêu:** Hỗ trợ hard-fork mà không mất dữ liệu.
- **Chỉ Tiêu Chấp Nhận:** Chuyển đổi < 100ms, không mất dữ liệu
- **Chu Kỳ:** Q1 2025

## Bước Tiếp Theo
- Tìm hiểu chi tiết: xem `./docs/code-standards.md` cho quy chuẩn lập trình
- Kiến trúc hệ thống: xem `./docs/system-architecture.md`
- Tóm tắt codebase: xem `./docs/codebase-summary.md`
- Thiết kế chi tiết: xem `./docs/Design.md`
