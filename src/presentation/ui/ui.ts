import chalk from "chalk";
import ora from "ora";

export interface Spinner {
  succeed(text?: string): void;
  fail(text?: string): void;
  stop(): void;
}

/** Everything the CLI prints goes through this interface so tests can capture it. */
export interface Ui {
  /** Raw text to stdout. */
  write(text: string): void;
  /** Raw text to stderr. */
  writeError(text: string): void;
  line(text?: string): void;
  heading(text: string): void;
  info(text: string): void;
  success(text: string): void;
  warn(text: string): void;
  error(text: string): void;
  spinner(text: string): Spinner;
}

export class TerminalUi implements Ui {
  write(text: string): void {
    process.stdout.write(text);
  }

  writeError(text: string): void {
    process.stderr.write(text);
  }

  line(text = ""): void {
    this.write(`${text}\n`);
  }

  heading(text: string): void {
    this.line(chalk.cyan.bold(text));
  }

  info(text: string): void {
    this.line(text);
  }

  success(text: string): void {
    this.line(chalk.green(`✔ ${text}`));
  }

  warn(text: string): void {
    this.writeError(`${chalk.yellow(`⚠ ${text}`)}\n`);
  }

  error(text: string): void {
    this.writeError(`${chalk.red(text)}\n`);
  }

  spinner(text: string): Spinner {
    const spinner = ora({ text, stream: process.stderr }).start();
    return {
      succeed: (message) => void spinner.succeed(message),
      fail: (message) => void spinner.fail(message),
      stop: () => void spinner.stop()
    };
  }
}
