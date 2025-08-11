// src/treeView.ts

import { TreeNode } from './types';
import { debugLog } from './utils';

export function createTreeStructure(paths: string[]): TreeNode {
    debugLog('Creating tree structure for paths:', paths);
    const root: TreeNode = { name: 'root', children: {}, isFile: false };

    for (const filePath of paths) {
        const parts = filePath.split('/');
        let currentNode = root;

        for (let i = 0; i < parts.length; i++) {
            const part = parts[i];
            const isFile = i === parts.length - 1;

            if (!currentNode.children[part]) {
                currentNode.children[part] = {
                    name: part,
                    children: {},
                    isFile
                };
            }
            currentNode = currentNode.children[part];
        }
    }
    return root;
}

export function generateTreeView(node: TreeNode, prefix: string = '', isLast = true): string {
    let result = '';

    if (node.name !== 'root') {
        result += prefix;
        result += isLast ? '└── ' : '├── ';
        result += node.name + '\n';
    }

    const childrenKeys = Object.keys(node.children);
    childrenKeys.sort((a, b) => {
        const childA = node.children[a];
        const childB = node.children[b];
        if (childA.isFile === childB.isFile) {
            return childA.name.localeCompare(childB.name);
        }
        return childA.isFile ? 1 : -1;
    });

    childrenKeys.forEach((key, index) => {
        const child = node.children[key];
        const isLastChild = index === childrenKeys.length - 1;
        const newPrefix = prefix + (node.name === 'root' ? '' : (isLast ? '    ' : '│   '));
        result += generateTreeView(child, newPrefix, isLastChild);
    });

    return result;
}