// src/types.ts

import * as vscode from 'vscode';

export interface ProcessingSummary {
    totalFiles: number;
    processedFiles: number;
    ignoredFiles: { path: string; reason: string }[];
    excludedFiles: string[];
    binaryFiles: string[];
    totalSize: number;
    estimatedTokens: number;
    timings: { [key: string]: number };
}

export interface IgnoreFileEntry {
    filePath: string;
    patterns: string[];
}

export interface TreeNode {
    name: string;
    children: { [key: string]: TreeNode };
    isFile: boolean;
}