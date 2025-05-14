/**
 * This Jest configuration is used to support the JestRunner extension (orta.vscode-jest) which executes tests
 * relative to the workspace root folder, and supports the Visual Studio Code Test Explorer. The Jest
 * configuration file relative to each package in the `packages` folder is used when Jest is run
 * via `turborepo`.
 */
export default {
  testEnvironment: 'node',
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        'tsconfig': './tsconfig.base.json',
        'useESM': true
      }
    ]
  },
  extensionsToTreatAsEsm: ['.ts'],
}
