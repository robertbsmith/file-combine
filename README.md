# File Combine

**File Combine** is a  Visual Studio Code extension designed to intelligently select and merge multiple files and folders into a single, clean output. It's built specifically to streamline the process of gathering project context for use with Large Language Models (LLMs) like ChatGPT, Claude, and Gemini.

The extension is highly configurable, allowing you to control exactly what information is included, helping you save tokens and provide clearer context to the AI.

![File Combine Context Menu](https://raw.githubusercontent.com/robertbsmith/file-combine/main/images/screenshot.png)

## Features

- **Combine Multiple Selections:** Select multiple files and folders and combine them all in one command.
- **Intelligent Ignoring:**
  - Automatically respects the rules in your `.gitignore` files.
  - Supports a custom `.filecombine` file (with `.gitignore` syntax) for specifying files you want the LLM to ignore, without cluttering your main `.gitignore`.
- **Configurable Output:** You have full control over what appears in the output. Enable or disable sections to save tokens and tailor the context:
  - **Processing Summary:** See file counts, total size, and an **estimated token count**.
  - **LLM Instructions:** Add a configurable preamble to guide the AI on how to interpret the files.
  - **Ignored Files List:** See exactly which files were excluded and why (grouped by the ignore file that excluded them).
  - **File Structure Tree:** A clean, tree-like view of the combined file hierarchy.
  - **Timings:** A breakdown of how long the process took.
- **Smart File Detection:** Automatically detects and skips binary files to prevent corrupted output.
- **Easy to Use:**
  - Integrates directly into the Explorer context menu.
  - Displays the combined output in a dedicated webview panel with a one-click **"Copy to Clipboard"** button.

## Usage

1.  In the VS Code Explorer, right-click on a file or folder.
2.  To select multiple items, hold `Ctrl` (Windows/Linux) or `Cmd` (Mac) and click on other files or folders.
3.  Right-click on one of the selected items and choose **"Combine Files"** from the context menu.
4.  A new editor tab will open with the combined content, ready to be copied.

## Extension Settings

This extension is highly configurable. You can change these settings in the VS Code Settings UI (`Ctrl/Cmd + ,`) or by editing your `settings.json` file.

| Setting | Description | Default |
| :--- | :--- | :--- |
| `fileCombine.llmInstructions` | A preamble to add to the output. Use this to provide context or specific instructions to the LLM. | `"This document contains a collection of files from a software project..."` |
| `fileCombine.showProcessingSummary` | Show the main summary block, including file counts, total size, and the estimated token count. | `true` |
| `fileCombine.showIgnoredFiles` | Show the lists of files that were ignored by `.gitignore`, `.filecombine`, or global settings. | `true` |
| `fileCombine.showTimings` | Show a breakdown of how long each stage of the combination process took. | `false` |
| `fileCombine.showFileStructure` | Show the ASCII tree view of the processed file structure. | `true` |
| `fileCombine.excludePatterns` | An array of glob patterns for files and folders to *always* exclude, regardless of ignore files (e.g., `node_modules/**`). | `[...]` |

### Using a `.filecombine` File

Sometimes, you want to exclude files from the LLM's context (like test mocks or unimportant documentation) but don't want to add them to your project's main `.gitignore` file.

You can create a `.filecombine` file in any directory of your project. The extension will look for and apply its rules hierarchically, just like `.gitignore`. The syntax is identical to `.gitignore`.

**Example `.filecombine`:**
```
# Exclude all test data from the LLM context
tests/data/

# Exclude a specific, verbose utility file
src/utils/noisy-helper.ts
```

## Release Notes

See the [CHANGELOG.md](CHANGELOG.md) file for a detailed history of changes and new features.

## Contributing

Contributions are welcome! If you have suggestions, find a bug, or want to add a new feature:

- **Fork the repository** on [GitHub](https://github.com/robertbsmith/file-combine).
- **Create a new branch** for your feature or bug fix.
- **Submit a pull request** with your changes.

Please make sure to follow the project's coding standards and include appropriate tests.

## Feedback and Support

- **Issues**: Report issues or request features on the [GitHub Issues](https://github.com/robertbsmith/file-combine/issues) page.
- **Contact**: For further questions, you can reach out via the contact information provided in the repository.

## License

This project is licensed under the [MIT License](LICENSE).