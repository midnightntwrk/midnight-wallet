export const dateToSeconds = (date: Date): bigint => {
  return BigInt(Math.floor(date.getTime() / 1000));
};

export const secondsToDate = (seconds: bigint | number): Date => {
  return new Date(Number(seconds) * 1000);
};

export const addSeconds = (time: Date, seconds: bigint | number): Date => {
  return new Date(+time + Number(seconds) * 1000);
};
