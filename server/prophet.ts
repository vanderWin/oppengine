import { spawn } from "child_process";
import { join } from "path";

interface SeriesPoint {
  date: string;
  value: number;
}

interface SeriesPayload {
  data: SeriesPoint[];
  trend: "flat" | "linear";
  multiplier: number;
}

interface ForecastPoint {
  date: string;
  yhat: number;
  yhat_lower: number;
  yhat_upper: number;
}

interface ForecastOutput {
  forecast: ForecastPoint[];
  last_observed: string;
  forecast_end: string;
}

export interface ProphetForecastInput {
  monthsAhead: number;
  brand: SeriesPayload;
  nonBrand: SeriesPayload;
}

export interface ProphetForecastResult {
  brand: ForecastOutput;
  nonBrand: ForecastOutput;
}

const PYTHON_SCRIPT = join(process.cwd(), "server", "python", "prophet_forecast.py");

export function runProphetForecast(input: ProphetForecastInput): Promise<ProphetForecastResult> {
  return new Promise((resolve, reject) => {
    const child = spawn("python", [PYTHON_SCRIPT], {
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");

    child.stdout.on("data", (data) => {
      stdout += data;
    });

    child.stderr.on("data", (data) => {
      stderr += data;
    });

    child.on("error", (error) => {
      reject(error);
    });

    child.on("close", (code) => {
      if (code !== 0) {
        const message = stderr || `Prophet script exited with code ${code}`;
        reject(new Error(message));
        return;
      }

      try {
        const parsed = JSON.parse(stdout) as ProphetForecastResult;
        resolve(parsed);
      } catch (error) {
        reject(new Error(`Failed to parse Prophet output: ${(error as Error).message}. Output: ${stdout}`));
      }
    });

    child.stdin.write(JSON.stringify(input));
    child.stdin.end();
  });
}
