export const NetworkId = {
  MainNet: 'main',
  TestNet: 'test',
  DevNet: 'dev',
  Undeployed: 'undeployed',
} as const;

export type NetworkId = (typeof NetworkId)[keyof typeof NetworkId];
