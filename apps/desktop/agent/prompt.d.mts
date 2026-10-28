export const AGENT_PROMPT: string;
export function promptForState(state:Record<string,unknown>,selection?:string[]):string;
export function toolGuidanceForState(state:Record<string,unknown>,selection?:string[]):string;
