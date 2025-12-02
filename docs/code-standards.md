# Quy Chuẩn Mã & Quy Ước Lập Trình

## Cấu Hình TypeScript

### tsconfig.base.json
```json
{
  "compilerOptions": {
    "module": "NodeNext",
    "target": "ESNext",
    "lib": ["ESNext"],
    "moduleResolution": "NodeNext",
    "strict": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "importHelpers": true,
    "noEmit": true,
    "composite": true,
    "resolveJsonModule": true,
    "noPropertyAccessFromIndexSignature": true,
    "alwaysStrict": true,
    "exactOptionalPropertyTypes": true,
    "skipLibCheck": true,
    "noFallthroughCasesInSwitch": true,
    "esModuleInterop": true,
    "erasableSyntaxOnly": true
  }
}
```

### Điểm Quan Trọng
- **Target:** ESNext (hiện đại, không cần transpiling)
- **Module System:** NodeNext (hỗ trợ ES modules)
- **Strict Mode:** Bật (type safety tối đa)
- **Declaration Maps:** Hỗ trợ IDE source mapping

## Quy Tắc ESLint

### Cấu Hình Chính (eslint.config.mjs)

#### Quy Tắc Độ Dài & Định Dạng
```javascript
'max-len': ['warn', { code: 120, tabWidth: 2 }],  // Tối đa 120 ký tự
'eol-last': ['error', 'always'],                  // EOF luôn có newline
'brace-style': ['error', 'stroustrup'],           // Cách trình bày dấu ngoặc nhọn
'no-trailing-spaces': 'off',                      // Cho phép trailing spaces
'object-curly-spacing': ['error', 'always'],      // Khoảng cách trong {}
```

#### Quy Tắc TypeScript
```javascript
'@typescript-eslint/explicit-module-boundary-types': 'warn',
'@typescript-eslint/no-unused-vars': [
  'warn',
  {
    argsIgnorePattern: '^_',
    destructuredArrayIgnorePattern: '^_',
    varsIgnorePattern: '^_'
  }
],
'@typescript-eslint/no-namespace': [
  'error',
  { allowDeclarations: true }  // Cho phép Effect.js style typing
]
```

#### Quy Tắc Tổng Quát
```javascript
'no-console': 'warn',                    // Cảnh báo console.log
'object-curly-newline': [
  'error',
  {
    ObjectExpression: { consistent: true },
    ObjectPattern: { consistent: true }
  }
]
```

## Quy Ước Đặt Tên

### Modules & Files
- **Kebab-case:** Tên file: `my-component.ts`, `wallet-builder.ts`
- **Index files:** Mỗi package có `src/index.ts` để export công khai
- **Subdirectories:** Tổ chức theo chức năng, không theo loại file

### Types & Interfaces
- **PascalCase:** `interface WalletState {}`, `type TransactionData = {...}`
- **Branded Types:** Sử dụng từ brand cho kiểu an toàn: `type WalletSeed = string & { readonly __brand: "WalletSeed" }`
- **Generics:** `<T>`, `<TState>`, `<TResult>`

### Variables & Functions
- **camelCase:** `const walletState = {}`, `function buildTransaction() {}`
- **Private Properties:** Dùng `#` prefix (private fields): `#internalState`
- **Constants:** `const MAX_RETRIES = 3`, `const DEFAULT_TIMEOUT = 5000`

### Enums & Tagged Unions
- **PascalCase:** `enum NetworkId {}`, `type TokenType = "shielded" | "unshielded" | "dust"`
- **Namespacing:** Dùng namespace cho related types:
  ```typescript
  namespace Address {
    export type Bech32m = string & { readonly __brand: "Bech32m" };
    export const format = (key: Uint8Array): Bech32m => { /* ... */ };
  }
  ```

## Cấu Trúc Tập Tin

### Cấu Trúc Chuẩn Package
```
packages/my-package/
├── src/
│   ├── index.ts                 # Main export
│   ├── types.ts                 # Type definitions
│   ├── capabilities/            # Capability implementations
│   │   └── MyCapability.ts
│   ├── services/                # Service implementations
│   │   └── MyService.ts
│   └── utils/                   # Utility functions
│       └── helpers.ts
├── test/
│   ├── MyCapability.test.ts
│   └── MyService.test.ts
├── package.json
├── tsconfig.json
├── tsconfig.build.json
├── tsconfig.publish.json
└── eslint.config.mjs
```

### Xuất Công Khai (exports)
```typescript
// index.ts - chỉ export những gì công khai
export * from './types';
export { MyCapability } from './capabilities/MyCapability';
export { MyService } from './services/MyService';

// Không export internal/private modules
```

## Mẫu Sử Dụng Effect.js

### Effect Patterns

#### 1. Service Definitions
```typescript
import { Effect } from 'effect';

interface DataService<TState> {
  fetchData(state: TState): Effect.Effect<FetchedData>;
  validateData(data: FetchedData): Effect.Effect<ValidData, ValidationError>;
}
```

#### 2. Capability Patterns
```typescript
interface DataCapability<TState> {
  applyData(state: TState, data: ValidData): TState;
  rollbackData(state: TState): TState | undefined;
}
```

#### 3. SubscriptionRef Management
```typescript
import { Effect, SubscriptionRef, Stream } from 'effect';

class MyVariant {
  readonly state: Stream.Stream<State>;
  readonly #ref: SubscriptionRef<State>;

  constructor(initialState: State) {
    this.#ref = SubscriptionRef.make(initialState);
    this.state = SubscriptionRef.changes(this.#ref);
  }

  updateState(updateFn: (state: State) => State): Effect.Effect<void> {
    return SubscriptionRef.update(this.#ref, updateFn);
  }

  updateStateWithEffect(
    updateFn: (state: State) => Effect.Effect<State>
  ): Effect.Effect<void> {
    return SubscriptionRef.updateEffect(this.#ref, updateFn);
  }
}
```

#### 4. Pipe & Composition
```typescript
import { pipe, Effect } from 'effect';

const result = pipe(
  fetchData(),
  Effect.flatMap(validate),
  Effect.map(transform),
  Effect.catch(handleError)
);
```

## Variant & Runtime Patterns

### Runtime Variant Interface
```typescript
interface RuntimeVariant {
  readonly tag: string;
  readonly startSync: () => Stream.Stream<StateChange>;
  readonly migrateFromPrevious: (
    previousState: unknown
  ) => Effect.Effect<VariantState>;
}
```

### Variant Implementation
```typescript
class MyVariant implements RuntimeVariant {
  readonly tag = "v1";

  constructor(
    private service: MyService<VariantState>,
    private capability: MyCapability<VariantState>
  ) {}

  startSync(): Stream.Stream<StateChange> {
    return this.service.streamUpdates();
  }

  migrateFromPrevious(
    previousState: unknown
  ): Effect.Effect<VariantState> {
    return Effect.succeed(this.capability.migrate(previousState as OldState));
  }
}
```

## Quy Ước Lỗi & Xử Lý

### Error Types
```typescript
// Branded error types
type ValidationError = Error & { readonly __brand: "ValidationError" };
type NetworkError = Error & { readonly __brand: "NetworkError" };

const createValidationError = (message: string): ValidationError =>
  Object.assign(new Error(message), { __brand: "ValidationError" as const });
```

### Either Pattern
```typescript
import { Either } from 'effect';

interface Capability<T> {
  operation(state: T): Either<T, OperationError>;
}
```

## Chuẩn Kiểm Thử

### Unit Test Structure
```typescript
import { describe, it, expect } from 'vitest';

describe('MyCapability', () => {
  it('should apply data correctly', () => {
    const state = createInitialState();
    const result = capability.applyData(state, testData);
    expect(result).toEqual(expectedState);
  });

  it('should handle errors gracefully', () => {
    const state = createInitialState();
    const result = capability.operation(state);
    expect(Either.isLeft(result)).toBe(true);
  });
});
```

### Test Organization
- Test files: `{module}.test.ts` next to source
- Setup files: `test/setup.ts` for common fixtures
- Mocks: `test/__mocks__/` for mock implementations

## Chuẩn Build & Distribution

### Build Scripts (per package)
```json
{
  "scripts": {
    "typecheck": "tsc -b ./tsconfig.json --noEmit",
    "lint": "eslint --max-warnings 0",
    "format": "prettier --write \"**/*.{ts,js,json,yaml,yml}\"",
    "dist": "tsc -b ./tsconfig.build.json",
    "clean": "rimraf --glob dist 'tsconfig.*.tsbuildinfo'"
  }
}
```

### Package Exports
```json
{
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    },
    "./submodule": {
      "types": "./dist/submodule/index.d.ts",
      "import": "./dist/submodule/index.js"
    }
  }
}
```

## Linting Cục Bộ

### Trước Commit
```bash
# Kiểm tra formatting
yarn format:check

# Kiểm tra linting
yarn lint

# Kiểm tra types
yarn typecheck

# Chạy tests
yarn test
```

### Full Verification (như CI)
```bash
turbo verify
```

## Các Tài Nguyên Tham Khảo
- TypeScript Handbook: https://www.typescriptlang.org/docs/
- Effect.js Docs: https://effect.website/
- ESLint Rules: https://eslint.org/docs/latest/rules/
- Project Design: `./docs/Design.md`
