# Change Log

All notable changes to the "file-combine" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [0.0.11]
- Added new `fileCombine.openInEditor` setting to open combined output in a regular editor tab instead of the webview, allowing save (Ctrl+S) and select all (Ctrl+A) (#1)

## [0.0.10]
- Fixed a critical issue where the extension would fail to load due to an ESM-only dependency (`istextorbinary`). Implemented a robust dynamic import to resolve this.
- Improved webview UI by making the "Copy to Clipboard" button float in the top-right corner, ensuring it is always accessible without obscuring the content.
- Correctly implemented the Content Security Policy (CSP) for inline styles in the webview, fixing the button's positioning.

## [0.0.9]
- Corrected breaking bug

## [0.0.8]
- Added support for user settings configurations
- Added .filecombine ignore support

## [0.0.7]
- Fixed character encoding issue in webview

## [0.0.6]
- Fixed duplication of file entry when a folder and the folder contents is selected.

## [0.0.5]
- Fixed directory handling

## [0.0.4]
- Better handling of unwanted files that aren't in git ignore like package-lock.json
- better support in the output for copying
- file contents summary at the top 

## [0.0.3] 
- Fixes to ignore logic
- better text file detection
- uses webview to avoid having the 'save as' every time it opens

## [0.0.2] 
- Updated to support project ignore files