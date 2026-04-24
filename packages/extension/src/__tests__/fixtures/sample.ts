import { readFileSync } from 'fs';
import { resolve } from 'path';

export interface Shape {
  area(): number;
  perimeter(): number;
}

export type Point = { x: number; y: number };

export function greet(name: string): string {
  return `Hello, ${name}`;
}

export function add(a: number, b: number): number {
  return a + b;
}

export class Animal {
  constructor(private name: string) {}

  speak(): void {
    console.log(`${this.name} makes a sound.`);
  }
}

export class Dog extends Animal {
  fetch(): void {
    greet('dog');
  }
}
