import { invokeCommand, type CommandPayload } from "./core";

export interface GreetInput extends CommandPayload {
  name: string;
}

export async function greet(input: GreetInput): Promise<string> {
  return invokeCommand<string>("greet", input);
}
