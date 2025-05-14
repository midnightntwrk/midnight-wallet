export default {
  testEnvironment: 'node',
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
