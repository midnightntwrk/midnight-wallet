# Midnight Wallet SDK - Tài Liệu & Hướng Dẫn

## Chào Mừng

Tài liệu toàn diện cho Midnight Wallet SDK - một monorepo TypeScript triển khai Midnight Wallet Specification.

## Bản Đồ Tài Liệu

### 📋 Quick Reference & Getting Started

**[README.md](../README.md)** - Điểm khởi đầu cho tất cả mọi người
- Features overview
- Quick start commands
- Development setup
- Basic usage examples
- Project structure

**[project-overview-pdr.md](./project-overview-pdr.md)** - Toàn cảnh dự án
- Project goals & vision
- Key features & capabilities
- Target users
- Technical requirements
- Success criteria
- Product Development Requirements (PDRs)

---

### 🏗️ Architecture & Design

**[system-architecture.md](./system-architecture.md)** - Kiến trúc hệ thống chi tiết
- High-level architecture diagram
- Component interactions
- Data flow patterns (sync, transaction, proving)
- State management patterns
- External service integration
- Security architecture
- Deployment patterns
- Performance characteristics

**[Design.md](./Design.md)** - Design patterns & principles (existing)
- Single wallet structure
- Single variant structure
- Service vs Capability distinction
- State immutability
- Effect.js patterns
- Code examples & references

**[decisions/](./decisions/)** - Architecture Decision Records (ADRs)
- Design decisions documented
- Rationale & trade-offs
- Evolution of architecture

---

### 📦 Code Organization & Standards

**[code-standards.md](./code-standards.md)** - Quy chuẩn lập trình & quy ước
- TypeScript configuration
- ESLint rules (14 key rules with explanations)
- Naming conventions (PascalCase, camelCase, kebab-case)
- File organization patterns
- Effect.js usage patterns
- Variant & Runtime patterns
- Error handling conventions
- Testing standards
- Build & distribution scripts

**[codebase-summary.md](./codebase-summary.md)** - Tóm tắt codebase
- Package structure (18 packages across 4 layers)
- Layer architecture (Foundation, Clients, Variants, Facade)
- Package descriptions with key files
- Dependency matrix
- State management pattern
- Transaction flow (8 steps)
- Technology stack

---

## Cách Sử Dụng

### Bạn là...

#### 🆕 Nhà Phát Triển Mới?
1. Đọc [README.md](../README.md) - Tổng quan dự án
2. Đọc [Quick Start](#quick-start) - Cài đặt & chạy
3. Xem [project-overview-pdr.md](./project-overview-pdr.md) - Tính năng chính
4. Xem [codebase-summary.md](./codebase-summary.md) - Cấu trúc code

#### 👨‍💻 Developer làm tính năng mới?
1. Xem [code-standards.md](./code-standards.md) - Quy chuẩn coding
2. Xem [system-architecture.md](./system-architecture.md) - Cách hoạt động
3. Xem [Design.md](./Design.md) - Patterns & examples
4. Check [decisions/](./decisions/) - Tại sao được thiết kế như vậy?

#### 🏗️ Architect / Tech Lead?
1. Xem [system-architecture.md](./system-architecture.md) - Full system design
2. Xem [Design.md](./Design.md) - Design patterns
3. Xem [project-overview-pdr.md](./project-overview-pdr.md) - Strategic goals
4. Xem [decisions/](./decisions/) - Historical decisions

#### 🧪 QA Engineer?
1. Xem [README.md](../README.md) - Testing commands
2. Xem [system-architecture.md](./system-architecture.md) - Component interactions
3. Xem [codebase-summary.md](./codebase-summary.md) - Test structure
4. Setup local: `docker-compose up`

---

## Quick Reference

### Cài Đặt & Chạy

```bash
# Setup
nvm use
corepack enable
yarn

# Build
turbo dist

# Test
turbo test
turbo verify

# Development
turbo watch dist
docker-compose up  # Local infrastructure
```

### Key Concepts

| Concept | File | Giải Thích |
|---------|------|----------|
| **Variant** | Design.md | Ví variant cho các phiên bản giao thức khác nhau |
| **Capability** | Design.md | Pure function extension trên State |
| **Service** | Design.md | Side-effecting operations (sync, proving) |
| **Runtime** | codebase-summary.md | Orchestrator cho variants |
| **Facade** | codebase-summary.md | Unified API cho tất cả ví types |
| **Effect.js** | code-standards.md | Functional effects & composition |

### Phụ Thuộc Chính

- **effect** ^3.17.3 - Functional effects
- **rxjs** ^7.5 - Reactive streams
- **typescript** 5.9.3 - Type safety
- **@midnight-ntwrk/ledger-v6** - Cryptography

---

## Documentation Statistics

| Document | Tác Dụng | Độ Dài | Đối Tượng |
|----------|---------|---------|----------|
| **README.md** | Quick start & overview | 277 dòng | Everyone |
| **project-overview-pdr.md** | Project goals & strategy | 171 dòng | PMs, Architects |
| **code-standards.md** | Coding conventions | 339 dòng | Developers |
| **codebase-summary.md** | Package structure | 374 dòng | Developers, Architects |
| **system-architecture.md** | System design | 673 dòng | Architects, Senior Devs |
| **Design.md** | Design patterns | 380 dòng | All (existing) |
| **decisions/** | Architecture decisions | Varied | Architects |

**Total:** ~2,200 lines of comprehensive documentation

---

## Common Tasks

### Thêm Wallet Variant Mới
→ Xem [Design.md](./Design.md) "Single Variant Structure"
→ Xem [code-standards.md](./code-standards.md) "Variant Patterns"

### Implement Capability Mới
→ Xem [Design.md](./Design.md) "Services and Capabilities"
→ Xem [code-standards.md](./code-standards.md) "Capability Patterns"

### Fix Issue Trong Sync
→ Xem [system-architecture.md](./system-architecture.md) "Pattern 1: Synchronization"
→ Xem [codebase-summary.md](./codebase-summary.md) "Transaction Flow"

### Deploy to Production
→ Xem [system-architecture.md](./system-architecture.md) "Deployment Architecture"
→ Xem [project-overview-pdr.md](./project-overview-pdr.md) "Current Status"

### Understand State Migration
→ Xem [system-architecture.md](./system-architecture.md) "Pattern 3: State Migration"
→ Xem [Design.md](./Design.md) "State type"

---

## Liên Kết Ngoài

### External References
- [Midnight Architecture](https://github.com/midnightntwrk/midnight-architecture)
- [Specification](https://github.com/midnightntwrk/midnight-architecture/blob/main/components/WalletEngine/Specification.md)
- [IcePanel Diagram](https://app.icepanel.io/landscapes/yERCUolKk91aYF1pzsql/)
- [Midnight Node](https://github.com/midnightntwrk/midnight-node)
- [Midnight Indexer](https://github.com/midnightntwrk/midnight-indexer)

### Development Resources
- TypeScript Handbook: https://www.typescriptlang.org/docs/
- Effect.js Docs: https://effect.website/
- ESLint Rules: https://eslint.org/docs/latest/rules/
- RxJS Guide: https://rxjs.dev/

---

## Trạng Thái Tài Liệu

- ✅ Project Overview & PDR
- ✅ Code Standards & Conventions
- ✅ Codebase Summary
- ✅ System Architecture
- ✅ Design Patterns (existing)
- ✅ Architecture Decisions (existing)

**Last Updated:** 2025-12-03
**Language:** Vietnamese
**Quality:** Comprehensive & Consistent

---

## Feedback & Updates

Documentation được cập nhật cùng với mỗi release. Nếu bạn tìm thấy bất kỳ:
- ❌ Lỗi hoặc thông tin cũ
- ❓ Phần khó hiểu
- 💡 Cần thêm ví dụ

Vui lòng tạo issue hoặc pull request.

---

**Navigation:** [Up to Project Root](../) | [Browse Issues](https://github.com/midnightntwrk/nocturne-midnight-wallet/issues)
