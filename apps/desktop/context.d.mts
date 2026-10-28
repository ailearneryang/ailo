import type { Model, Message, Extension, ContextCheckpoint } from './src/types';
import type { AgentRun } from './src/types';
export type WireMessage = { role: 'user' | 'assistant'; content: string; attachmentTokens?: number };
export type ContextUsage = { rows: { label: string; color: string; tokens: number }[]; used: number; window: number; reserve: number; ratio: number; threshold: number; checkpoint?: ContextCheckpoint };
export function serializeMessage(message: Pick<Message, 'role' | 'content' | 'materials' | 'clarification'>): WireMessage;
export function contextUsage(messages: WireMessage[], extensions: Extension[], model: Model, checkpoint?: ContextCheckpoint): ContextUsage;
export function agentContextUsage(messages: Pick<Message,'role'|'content'|'materials'|'clarification'>[], extensions:Extension[], model:Model, run?:AgentRun): ContextUsage & {materialTokens:number};

export function requestContextUsage(messages: {role:string;content:string}[], format:Record<string,unknown>, model:Model, outputBudget:number): Omit<import("./src/types").RequestContextUsage,"requestId">;
export function prepareRequestBudget(messages:{role:string;content:unknown}[],format:Record<string,unknown>,model:Model,requestedOutput:number):{budget:number;stats:Omit<import('./src/types').RequestContextUsage,'requestId'> & {requestedReserve:number;budgetAdjusted:boolean;guardTokens:number}};
