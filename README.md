# Obsidian E-Book Reader Plugin

Read and manage your e-books directly in Obsidian with a feature-rich reading experience.

## Features

- **EPUB Support**: Read EPUB files directly in Obsidian
- **Library Management**: Organize your e-books with automatic metadata extraction
- **Reading Features**: Bookmarks, highlights, notes, and progress tracking
- **Customizable Experience**: Adjust font size, line height, margins, and choose between light, dark, and sepia themes
- **Cloud Sync**: Connect to Dropbox, Google Drive, or OneDrive to sync your library and reading progress

## Installation

### From Obsidian Community Plugins

1. Open Obsidian Settings
2. Go to Community Plugins and turn off Safe Mode
3. Click Browse and search for "E-Book Reader"
4. Install the plugin and enable it

### Manual Installation

1. Download the latest release from the [Releases page](https://github.com/yourusername/obsidian-ebook-reader/releases)
2. Extract the ZIP file to your Obsidian plugins folder: `{vault}/.obsidian/plugins/`
3. Reload Obsidian
4. Enable the plugin in the Community Plugins settings

## Usage

### Setting Up Your Library

1. Go to plugin settings and set your library path (default is "Books")
2. Import e-books using the ribbon icon or command palette
3. Your imported books will appear in the library view

### Reading Books

1. Open the library view and click on a book to start reading
2. Use the navigation controls at the bottom to move between chapters
3. Access the table of contents from the header button
4. Adjust reading settings using the settings button in the header

### Annotations

- **Bookmarks**: Click the bookmark button in the settings menu
- **Highlights**: Select text and choose a highlight color from the popup menu
- **Notes**: Select text and click "Add Note" from the popup menu, or add a standalone note from the settings menu

### Cloud Integration

1. Go to plugin settings and enter your API credentials for your preferred cloud service
2. Enable sync and choose what data to synchronize
3. Use the "Sync E-Books with Cloud" command to manually sync

## Configuration

The plugin settings allow you to customize:

- Library location
- Reading experience (font size, line height, theme, etc.)
- Cloud service connections
- Synchronization options

## Development

### Prerequisites

- Node.js and npm

### Building

1. Clone this repository
2. Install dependencies with `npm install`
3. Build the plugin with `npm run build`

### Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Acknowledgments

- [Obsidian](https://obsidian.md/) for the amazing knowledge base application
- [JSZip](https://stuk.github.io/jszip/) for EPUB parsing capabilities