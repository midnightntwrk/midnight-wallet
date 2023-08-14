import { jest } from '@jest/globals';
import { Readline } from '../lib/Readline';
import type { ReadlineType } from '../lib/Readline';

/*
  A better alternative to this would've been to spawn a child process and collect the inputs/outputs
  and run the test against those, however given that this package won't be used for long and the
  little amount of time we have, it is good enough.
*/

describe('Readline', () => {
  let readline: ReadlineType;

  beforeAll(() => {
    readline = new Readline();
  });

  afterAll(() => {
    readline.close();
  });

  it('should ask a question', () => {
    const question = 'Do you want to sign this transaction?';

    readline.question = jest.fn(readline.question);

    void readline.question(question);

    expect(readline.question).toHaveBeenCalledWith(question);
  });

  it('should print', () => {
    const print = 'Sample text.';

    readline.print = jest.fn(readline.print);

    readline.print(print);

    expect(readline.print).toHaveBeenCalledWith(print);
  });

  it('should clear', () => {
    readline.clear = jest.fn(readline.clear);

    readline.clear();

    expect(readline.clear).toHaveBeenCalled();
  });

  it('should close', () => {
    readline.close = jest.fn(readline.close);

    readline.close();

    expect(readline.close).toHaveBeenCalled();
  });
});
