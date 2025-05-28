export default {
  testEnvironment: 'node',
  maxWorkers: 1, // Due to beloved usage of JSON.stringify and its issues with BigInt
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        'tsconfig': './tsconfig.test.json',
        'useESM': true
      }
    ]
  },
  extensionsToTreatAsEsm: ['.ts']
}
