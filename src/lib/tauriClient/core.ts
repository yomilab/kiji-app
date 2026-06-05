import { invoke } from "@tauri-apps/api/core";

export interface CommandPayload extends Record<string, unknown> {}

export type ContractCommand = {
  request?: unknown;
  response: unknown;
};

export type ContractRequest<TCommand extends ContractCommand> =
  TCommand extends { request: infer TRequest } ? TRequest : undefined;

export type ContractResponse<TCommand extends ContractCommand> = TCommand["response"];

export async function invokeCommand<TResponse>(
  command: string,
  payload?: CommandPayload,
): Promise<TResponse> {
  return invoke<TResponse>(command, payload);
}

export async function invokeContract<TCommand extends ContractCommand>(
  command: string,
  payload?: ContractRequest<TCommand> extends undefined
    ? undefined
    : ContractRequest<TCommand>,
): Promise<ContractResponse<TCommand>> {
  return invokeCommand<ContractResponse<TCommand>>(
    command,
    payload as CommandPayload | undefined,
  );
}
