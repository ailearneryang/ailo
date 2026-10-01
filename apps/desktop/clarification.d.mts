import type { Clarification, ClarificationAnswer } from './src/types';
export const CLARIFICATION_PROMPT: string;
export function validateClarification(value: unknown): Clarification | undefined;
export function parseClarification(content: string): {content:string;clarification?:Clarification};
export function visibleReply(content: string): string;
export function questionContext(value: Clarification): string;
export function formatAnswers(value: Clarification, answers: ClarificationAnswer[]): string;
