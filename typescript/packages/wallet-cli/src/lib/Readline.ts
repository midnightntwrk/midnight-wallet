import readline from 'readline';
import { stdin as input, stdout as output } from 'process';

export interface ReadlineType {
  readline: readline.Interface;
  question: (question: string) => Promise<string>;
  print: (value: string) => void;
  clear: () => void;
  close: () => void;
}

class Readline implements ReadlineType {
  readline: readline.Interface;

  constructor() {
    this.readline = readline.createInterface({
      input,
      output,
      terminal: false,
    });
  }

  async question(question: string): Promise<string> {
    return await new Promise((resolve) => {
      this.readline.question(question, (answer) => {
        resolve(answer);
      });
    });
  }

  print(value: string): void {
    console.log(value);
  }

  clear(): void {
    console.clear();
  }

  close(): void {
    this.readline.close();
  }
}

export { Readline };
