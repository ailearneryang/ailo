export function supportsReasoning(model: {baseUrl:string;model:string}): boolean;
export function reasoningParameters(model: {baseUrl:string;model:string}, effort?:string): Record<string,unknown>;
