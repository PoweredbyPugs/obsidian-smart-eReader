import { ItemView, WorkspaceLeaf, Menu, TFile, Notice } from 'obsidian';
import { Book } from './libraryManager';
import EbookReaderPlugin from './main';
import { parseEpub, EpubContent, EpubNavPoint } from './epubParser';

export const READER_VIEW_TYPE = 'ebook-reader-view';

export interface ReadingState {
    currentLocation: string; // Current chapter/section ID
    position: number; // Position within the current chapter (percentage or scroll position)
    bookmarks: Bookmark[];
    highlights: Highlight[];
    notes: Note[];
}

interface Bookmark {
    id: string;
    chapterId: string;
    position: number;
    createdAt: number;
    title: string;
}

interface Highlight {
    id: string;
    chapterId: string;
    text: string;
    startOffset: number;
    endOffset: number;
    color: string;
    createdAt: number;
}

interface Note {
    id: string;
    chapterId: string;
    text: string;
    associatedHighlightId?: string;
    position: number;
    createdAt: number;
    updatedAt: number;
}

export class ReaderView extends ItemView {
    private plugin: EbookReaderPlugin;
    private containerDiv: HTMLElement; // Changed from contentEl to avoid conflict
    private book: Book | null = null;
    private epubContent: EpubContent | null = null;
    private readingState: ReadingState | null = null;
    
    private headerEl: HTMLElement;
    private tocEl: HTMLElement;
    private readerEl: HTMLElement;
    private footerEl: HTMLElement;
    
    private currentChapterIndex: number = 0;
    private totalChapters: number = 0;
    
    // Array to store blob URLs for cleanup
    private blobUrls: string[] = [];
    
    constructor(leaf: WorkspaceLeaf, plugin: EbookReaderPlugin) {
        super(leaf);
        this.plugin = plugin;
    }

    getViewType(): string {
        return READER_VIEW_TYPE;
    }

    getDisplayText(): string {
        return this.book?.title || 'E-Book Reader';
    }

    getIcon(): string {
        return 'book-open';
    }

    async onOpen() {
        // Create the main container for the reader
        this.containerDiv = this.containerEl.createDiv({ cls: 'ebook-reader-container' });
        
        // Create the header, TOC sidebar, reader content, and footer areas
        this.headerEl = this.containerDiv.createDiv({ cls: 'ebook-reader-header' });
        
        const mainAreaEl = this.containerDiv.createDiv({ cls: 'ebook-reader-main' });
        this.tocEl = mainAreaEl.createDiv({ cls: 'ebook-reader-toc' });
        this.readerEl = mainAreaEl.createDiv({ cls: 'ebook-reader-content' });
        
        this.footerEl = this.containerDiv.createDiv({ cls: 'ebook-reader-footer' });
        
        // Apply the current theme and reading settings
        this.applyReadingSettings();
        
        // If we have a previously loaded book, display it
        if (this.book && this.epubContent) {
            this.renderBook();
        } else {
            this.showWelcomeScreen();
        }
    }

    async loadBook(book: Book) {
        this.book = book;
        
        // Clear current content
        if (this.readerEl) {
            this.readerEl.empty();
            this.tocEl.empty();
            this.headerEl.empty();
            this.footerEl.empty();
        }
        
        // Show loading indicator
        this.readerEl?.createDiv({ text: 'Loading book...', cls: 'ebook-reader-loading' });
        
        try {
            // Get the file from the vault
            const file = this.app.vault.getAbstractFileByPath(book.path);
            if (!(file instanceof TFile)) {
                throw new Error(`Cannot find file: ${book.path}`);
            }
            
            // Read the file data
            const data = await this.app.vault.readBinary(file);
            
            // Parse the EPUB
            this.epubContent = await parseEpub(data);
            
            // Load or initialize reading state
            this.readingState = await this.plugin.storageManager.getReadingState(book.id) || {
                currentLocation: this.epubContent.spine.items[0] || '',
                position: 0,
                bookmarks: [],
                highlights: [],
                notes: []
            };
            
            // Render the book content
            this.renderBook();
            
        } catch (error) {
            console.error('Error loading book:', error);
            this.readerEl?.empty();
            this.readerEl?.createDiv({ 
                text: `Error loading book: ${error.message}`, 
                cls: 'ebook-reader-error' 
            });
        }
    }

    private renderBook() {
        if (!this.book || !this.epubContent || !this.readingState) return;
        
        // Clear everything
        this.headerEl.empty();
        this.tocEl.empty();
        this.readerEl.empty();
        this.footerEl.empty();
        
        // Set up the header with book title and controls
        this.renderHeader();
        
        // Set up the table of contents
        this.renderTOC();
        
        // Set up the content area
        this.renderContent();
        
        // Set up the footer with navigation controls
        this.renderFooter();
        
        // Navigate to the saved position
        this.navigateToLocation(this.readingState.currentLocation, this.readingState.position);
    }

    private renderHeader() {
        const headerControls = this.headerEl.createDiv({ cls: 'ebook-reader-header-controls' });
        
        // Back to library button
        headerControls.createEl('button', {
            text: 'Library',
            cls: 'ebook-reader-btn',
            attr: { title: 'Return to Library' }
        }).addEventListener('click', () => {
            this.plugin.openLibraryView();
        });
        
        // Book title
        this.headerEl.createEl('h2', {
            text: this.book?.title || 'Unknown Book',
            cls: 'ebook-reader-title'
        });
        
        // Right side controls
        const rightControls = this.headerEl.createDiv({ cls: 'ebook-reader-header-right' });
        
        // Table of contents toggle button
        rightControls.createEl('button', {
            text: 'Contents',
            cls: 'ebook-reader-btn',
            attr: { title: 'Toggle Table of Contents' }
        }).addEventListener('click', () => {
            this.tocEl.toggleClass('ebook-reader-toc-visible', true);
        });
        
        // Settings button
        rightControls.createEl('button', {
            text: 'Settings',
            cls: 'ebook-reader-btn',
            attr: { title: 'Reading Settings' }
        }).addEventListener('click', (event) => {
            this.showSettingsMenu(event);
        });
        
        // Bookmarks button
        rightControls.createEl('button', {
            text: 'Bookmarks',
            cls: 'ebook-reader-btn',
            attr: { title: 'View Bookmarks' }
        }).addEventListener('click', (event) => {
            this.showBookmarksMenu(event);
        });
    }

    private renderTOC() {
        if (!this.epubContent) return;
        
        // Create TOC header
        this.tocEl.createEl('h3', { text: 'Table of Contents' });
        
        // Create close button for mobile
        const closeBtn = this.tocEl.createEl('button', {
            text: 'Close',
            cls: 'ebook-reader-btn ebook-reader-toc-close-btn'
        });
        closeBtn.addEventListener('click', () => {
            this.tocEl.toggleClass('ebook-reader-toc-visible', false);
        });
        
        // Create TOC list
        const tocList = this.tocEl.createEl('ul', { cls: 'ebook-reader-toc-list' });
        
        // If we have navPoints from NCX, use those
        if (this.epubContent.navPoints && this.epubContent.navPoints.length > 0) {
            this.renderNavPoints(this.epubContent.navPoints, tocList);
        } else {
            // Fallback to spine items
            this.epubContent.spine.items.forEach((itemId: string, index: number) => {
                const item = this.epubContent?.manifest[itemId];
                if (item) {
                    const li = tocList.createEl('li');
                    const link = li.createEl('a', {
                        text: `Chapter ${index + 1}`,
                        href: '#'
                    });
                    
                    link.addEventListener('click', (event) => {
                        event.preventDefault();
                        this.navigateToLocation(itemId, 0);
                    });
                }
            });
        }
    }

    private renderNavPoints(navPoints: EpubNavPoint[], parentEl: HTMLElement) {
        navPoints.forEach(navPoint => {
            const li = parentEl.createEl('li');
            const link = li.createEl('a', {
                text: navPoint.label,
                href: '#'
            });
            
            link.addEventListener('click', (event) => {
                event.preventDefault();
                // Parse the href to get the chapter ID and position
                const href = navPoint.href;
                const parts = href.split('#');
                
                // Find the manifest item that contains this content
                const itemId = this.findManifestItemForHref(parts[0]);
                if (itemId) {
                    this.navigateToLocation(itemId, 0, parts[1]);
                }
                
                // Close the TOC on mobile
                this.tocEl.toggleClass('ebook-reader-toc-visible', false);
            });
            
            // Render children if any
            if (navPoint.children && navPoint.children.length > 0) {
                const childList = li.createEl('ul');
                this.renderNavPoints(navPoint.children, childList);
            }
        });
    }

    private findManifestItemForHref(href: string): string | null {
        if (!this.epubContent) return null;
        
        // Loop through manifest items and find the one that matches the href
        for (const [id, item] of Object.entries(this.epubContent.manifest)) {
            if (item && typeof item === 'object' && 'href' in item && typeof item.href === 'string' && item.href.endsWith(href)) {
                return id;
            }
        }
        
        return null;
    }

    private renderContent() {
        // Create a container for the chapter content
        this.readerEl.createDiv({ cls: 'ebook-reader-chapter' });
    }

    private renderFooter() {
        // Create navigation controls
        const prevBtn = this.footerEl.createEl('button', {
            text: 'Previous',
            cls: 'ebook-reader-nav-btn'
        });
        prevBtn.addEventListener('click', () => {
            this.navigateToPreviousChapter();
        });
        
        // Reading progress
        const progressContainer = this.footerEl.createDiv({ cls: 'ebook-reader-progress' });
        
        const progressSlider = progressContainer.createEl('input', {
            cls: 'ebook-reader-progress-slider',
            attr: {
                type: 'range',
                min: '0',
                max: '100',
                value: '0'
            }
        });
        
        progressSlider.addEventListener('input', (event) => {
            const target = event.target as HTMLInputElement;
            const percent = parseInt(target.value, 10);
            this.scrollToPercent(percent);
        });
        
        const progressText = progressContainer.createDiv({ 
            cls: 'ebook-reader-progress-text',
            text: 'Page 1 of 1'
        });
        
        // Next button
        const nextBtn = this.footerEl.createEl('button', {
            text: 'Next',
            cls: 'ebook-reader-nav-btn'
        });
        nextBtn.addEventListener('click', () => {
            this.navigateToNextChapter();
        });
        
        // Update the current progress
        this.updateProgressDisplay();
    }

    private navigateToLocation(itemId: string, position: number, fragment?: string) {
        if (!this.epubContent || !this.readingState) return;
        
        // Find the chapter index
        const chapterIndex = this.epubContent.spine.items.indexOf(itemId);
        if (chapterIndex === -1) return;
        
        this.currentChapterIndex = chapterIndex;
        this.totalChapters = this.epubContent.spine.items.length;
        
        // Get the chapter content
        const content = this.epubContent.content[itemId];
        if (!content) return;
        
        // Update the reading state
        this.readingState.currentLocation = itemId;
        this.readingState.position = position;
        this.saveReadingState();
        
        // Render the chapter content
        const chapterEl = this.readerEl.querySelector('.ebook-reader-chapter');
        if (chapterEl) {
            // Process the HTML to make it safe and apply our styling
            const processedHtml = this.processChapterHtml(content);
            chapterEl.innerHTML = processedHtml;
            
            // Scroll to position
            if (fragment) {
                const target = chapterEl.querySelector(`#${fragment}`);
                if (target) {
                    target.scrollIntoView();
                }
            } else {
                this.scrollToPercent(position);
            }
            
            // Update the progress display
            this.updateProgressDisplay();
            
            // Add event listeners for text selection (for highlights)
            if (chapterEl instanceof HTMLElement) {
                this.setupTextSelectionHandlers(chapterEl);
            }
        }
    }

    private processChapterHtml(html: string): string {
        // Create a temporary div to hold the HTML
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = html;
        
        // Fix relative URLs in images and links
        const baseUrl = `app://obsidian/${this.book?.path || ''}`;
        
        // Process images
        const images = tempDiv.querySelectorAll('img');
        Array.from(images).forEach(img => {
            const src = img.getAttribute('src');
            const originalSrc = img.getAttribute('data-original-src');
            
            if (originalSrc && this.epubContent) {
                // Try to find the image in resources
                const resourceKey = this.findResourceKey(originalSrc);
                if (resourceKey) {
                    // Create a blob URL for the image
                    const imageData = this.epubContent.resources[resourceKey];
                    if (imageData) {
                        try {
                            // Create a blob from the binary data
                            const blob = new Blob([imageData], { type: this.getImageMimeType(originalSrc) });
                            const url = URL.createObjectURL(blob);
                            img.src = url;
                            
                            // Store URL for cleanup
                            this.blobUrls.push(url);
                        } catch (e) {
                            console.error('Error creating blob URL for image:', e);
                        }
                    }
                } else if (src && !src.startsWith('http') && !src.startsWith('blob:') && !src.startsWith('data:')) {
                    // Fallback to relative path if resource not found directly
                    try {
                        img.src = new URL(src, baseUrl).href;
                    } catch (e) {
                        console.error('Error creating URL for image:', e);
                    }
                }
            } else if (src && !src.startsWith('http') && !src.startsWith('blob:') && !src.startsWith('data:')) {
                // For images without data-original-src
                try {
                    img.src = new URL(src, baseUrl).href;
                } catch (e) {
                    console.error('Error creating URL for image:', e);
                }
            }
        });
        
        // Process internal links - no event listeners can be added here since this is just string processing
        const links = tempDiv.querySelectorAll('a');
        Array.from(links).forEach(link => {
            const href = link.getAttribute('href');
            if (href) {
                if (href.startsWith('#')) {
                    // Internal link to the same document - add a data attribute for later processing
                    link.setAttribute('data-internal-link', 'true');
                } else if (!href.startsWith('http')) {
                    // Internal link to another part of the book - add a data attribute
                    link.setAttribute('data-ebook-link', 'true');
                } else {
                    // External link - open in browser
                    link.setAttribute('target', '_blank');
                    link.setAttribute('rel', 'noopener noreferrer');
                }
            }
        });
        
        // Apply highlights if any
        if (this.readingState && this.readingState.highlights.length > 0) {
            this.applyHighlights(tempDiv);
        }
        
        return tempDiv.innerHTML;
    }

    private findResourceKey(originalSrc: string): string | null {
        if (!this.epubContent) return null;
        
        // Try different variations of the path
        const variations = [
            originalSrc,
            originalSrc.split('/').pop() || '',  // Just the filename
            originalSrc.replace(/\.\.\//g, ''),  // Remove ../ references
            decodeURIComponent(originalSrc)      // URL-decoded
        ];
        
        for (const variation of variations) {
            if (this.epubContent.resources[variation]) {
                return variation;
            }
        }
        
        // If not found directly, try to find a partial match
        for (const key of Object.keys(this.epubContent.resources)) {
            if (key.endsWith(originalSrc.split('/').pop() || '')) {
                return key;
            }
        }
        
        return null;
    }

    private getImageMimeType(path: string): string {
        const extension = path.split('.').pop()?.toLowerCase();
        switch (extension) {
            case 'jpg':
            case 'jpeg':
                return 'image/jpeg';
            case 'png':
                return 'image/png';
            case 'gif':
                return 'image/gif';
            case 'svg':
                return 'image/svg+xml';
            case 'webp':
                return 'image/webp';
            default:
                return 'image/jpeg'; // Default
        }
    }

    private scrollToPercent(percent: number) {
        const chapterEl = this.readerEl.querySelector('.ebook-reader-chapter');
        if (chapterEl) {
            const scrollHeight = chapterEl.scrollHeight - chapterEl.clientHeight;
            const scrollTop = (scrollHeight * percent) / 100;
            chapterEl.scrollTop = scrollTop;
            
            // Update reading state
            if (this.readingState) {
                this.readingState.position = percent;
                this.saveReadingState();
            }
        }
    }

    private navigateToPreviousChapter() {
        if (!this.epubContent || this.currentChapterIndex <= 0) return;
        
        const prevChapterId = this.epubContent.spine.items[this.currentChapterIndex - 1];
        this.navigateToLocation(prevChapterId, 0);
    }

    private navigateToNextChapter() {
        if (!this.epubContent || this.currentChapterIndex >= this.totalChapters - 1) return;
        
        const nextChapterId = this.epubContent.spine.items[this.currentChapterIndex + 1];
        this.navigateToLocation(nextChapterId, 0);
    }

    private updateProgressDisplay() {
        // Calculate overall progress
        const overallProgress = this.totalChapters === 0 ? 0 : 
            ((this.currentChapterIndex / this.totalChapters) * 100).toFixed(1);
        
        // Update progress text
        const progressText = this.footerEl.querySelector('.ebook-reader-progress-text');
        if (progressText) {
            progressText.textContent = `${this.currentChapterIndex + 1} of ${this.totalChapters} (${overallProgress}%)`;
        }
        
        // Update progress slider
        const progressSlider = this.footerEl.querySelector('.ebook-reader-progress-slider') as HTMLInputElement;
        if (progressSlider && this.readingState) {
            progressSlider.value = this.readingState.position.toString();
        }
        
        // Update book progress in library
        if (this.book) {
            this.book.progress = Number(overallProgress);
            this.plugin.library.updateBook(this.book);
        }
    }

    private applyHighlights(container: HTMLElement) {
        if (!this.readingState || !this.epubContent) return;
        
        const currentItemId = this.readingState.currentLocation;
        const highlights = this.readingState.highlights.filter(h => h.chapterId === currentItemId);
        
        if (highlights.length === 0) return;
        
        // This is a simplified implementation - in practice, you'd need to use a
        // more robust text finding and highlighting approach
        const textNodes = this.getTextNodes(container);
        
        highlights.forEach(highlight => {
            // Find the text and wrap it in a highlight span
            // This is a simplified approach and might not work for all cases
            const textContent = container.textContent || '';
            const highlightText = highlight.text;
            
            if (textContent.includes(highlightText)) {
                // Replace the text with highlighted version
                // Note: This is not a robust implementation
                const regex = new RegExp(this.escapeRegExp(highlightText), 'g');
                const highlightedHtml = `<span class="ebook-highlight" style="background-color: ${highlight.color};" data-highlight-id="${highlight.id}">${highlightText}</span>`;
                
                // This is a simplistic approach - would need more robust implementation
                container.innerHTML = container.innerHTML.replace(regex, highlightedHtml);
            }
        });
    }

    private escapeRegExp(string: string): string {
        return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    private getTextNodes(node: Node): Text[] {
        const textNodes: Text[] = [];
        
        function collectTextNodes(node: Node) {
            if (node.nodeType === Node.TEXT_NODE) {
                textNodes.push(node as Text);
            } else {
                const children = node.childNodes;
                for (let i = 0; i < children.length; i++) {
                    collectTextNodes(children[i]);
                }
            }
        }
        
        collectTextNodes(node);
        return textNodes;
    }

    private setupTextSelectionHandlers(container: HTMLElement) {
        container.addEventListener('mouseup', (evt) => {
            const selection = window.getSelection();
            if (selection && !selection.isCollapsed) {
                const text = selection.toString().trim();
                if (text) {
                    this.showTextSelectionMenu(evt as MouseEvent, text);
                }
            }
        });
    }

    private showTextSelectionMenu(evt: MouseEvent, selectedText: string) {
        const menu = new Menu();
        
        // Add highlight options
        const highlightColors = ['yellow', 'green', 'blue', 'pink', 'purple'];
        highlightColors.forEach(color => {
            menu.addItem(item => {
                item
                    .setTitle(`Highlight ${color}`)
                    .onClick(() => {
                        this.addHighlight(selectedText, color);
                    });
            });
        });
        
        // Add note option
        menu.addItem(item => {
            item
                .setTitle('Add Note')
                .onClick(() => {
                    this.addNote(selectedText);
                });
        });
        
        // Add copy option
        menu.addItem(item => {
            item
                .setTitle('Copy')
                .onClick(() => {
                    navigator.clipboard.writeText(selectedText);
                });
        });
        
        // Show the menu
        menu.showAtMouseEvent(evt);
    }

    private addHighlight(text: string, color: string) {
        if (!this.readingState) return;
        
        const highlight: Highlight = {
            id: `highlight_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            chapterId: this.readingState.currentLocation,
            text,
            startOffset: 0, // This would need to be calculated for proper implementation
            endOffset: 0,   // This would need to be calculated for proper implementation
            color,
            createdAt: Date.now()
        };
        
        this.readingState.highlights.push(highlight);
        this.saveReadingState();
        
        // Refresh the current chapter to show the highlight
        this.navigateToLocation(this.readingState.currentLocation, this.readingState.position);
    }

    private addNote(text?: string) {
        if (!this.readingState) return;
        
        // Create a modal for entering the note
        // For simplicity, we're just using a prompt here
        const noteText = prompt('Enter your note:', text || '');
        if (!noteText) return;
        
        const note: Note = {
            id: `note_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            chapterId: this.readingState.currentLocation,
            text: noteText,
            position: this.readingState.position,
            createdAt: Date.now(),
            updatedAt: Date.now()
        };
        
        this.readingState.notes.push(note);
        this.saveReadingState();
    }

    private addBookmark() {
        if (!this.readingState || !this.book) return;
        
        // Get current chapter title or generate one
        let chapterTitle = `Chapter ${this.currentChapterIndex + 1}`;
        
        // Try to find a better title from the navigation points
        if (this.epubContent && this.epubContent.navPoints) {
            const currentItemId = this.readingState.currentLocation;
            const item = this.epubContent.manifest[currentItemId];
            
            if (item) {
                // Try to find a nav point that points to this item
                for (const navPoint of this.epubContent.navPoints) {
                    if (navPoint.href.includes(item.href.split('/').pop() || '')) {
                        chapterTitle = navPoint.label;
                        break;
                    }
                }
            }
        }
        
        const bookmarkTitle = prompt('Bookmark title:', `${this.book.title} - ${chapterTitle}`);
        if (!bookmarkTitle) return;
        
        const bookmark: Bookmark = {
            id: `bookmark_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            chapterId: this.readingState.currentLocation,
            position: this.readingState.position,
            createdAt: Date.now(),
            title: bookmarkTitle
        };
        
        this.readingState.bookmarks.push(bookmark);
        this.saveReadingState();
    }

    private saveReadingState() {
        if (!this.readingState || !this.book) return;
        
        this.plugin.storageManager.saveReadingState(this.book.id, this.readingState);
    }

    private applyReadingSettings() {
        if (!this.containerDiv) return;
        
        // Apply theme
        const theme = this.plugin.settings.reading.theme;
        this.containerDiv.setAttribute('data-theme', theme);
        
        // Apply font size
        this.containerDiv.style.setProperty('--ebook-font-size', `${this.plugin.settings.reading.fontSize}px`);
        
        // Apply line height
        this.containerDiv.style.setProperty('--ebook-line-height', this.plugin.settings.reading.lineHeight.toString());
        
        // Apply font family
        this.containerDiv.style.setProperty('--ebook-font-family', this.plugin.settings.reading.fontFamily);
        
        // Apply margins
        this.containerDiv.style.setProperty('--ebook-margins', `${this.plugin.settings.reading.margins}em`);
    }

    private showSettingsMenu(evt: MouseEvent) {
        const menu = new Menu();
        
        // Font size
        menu.addItem(item => {
            item
                .setTitle('Increase Font Size')
                .onClick(() => {
                    this.plugin.settings.reading.fontSize += 1;
                    this.plugin.saveSettings();
                    this.applyReadingSettings();
                });
        });
        
        menu.addItem(item => {
            item
                .setTitle('Decrease Font Size')
                .onClick(() => {
                    this.plugin.settings.reading.fontSize = Math.max(10, this.plugin.settings.reading.fontSize - 1);
                    this.plugin.saveSettings();
                    this.applyReadingSettings();
                });
        });
        
        // Theme
        menu.addItem(item => {
            item
                .setTitle('Light Theme')
                .onClick(() => {
                    this.plugin.settings.reading.theme = 'light';
                    this.plugin.saveSettings();
                    this.applyReadingSettings();
                });
        });
        
        menu.addItem(item => {
            item
                .setTitle('Dark Theme')
                .onClick(() => {
                    this.plugin.settings.reading.theme = 'dark';
                    this.plugin.saveSettings();
                    this.applyReadingSettings();
                });
        });
        
        menu.addItem(item => {
            item
                .setTitle('Sepia Theme')
                .onClick(() => {
                    this.plugin.settings.reading.theme = 'sepia';
                    this.plugin.saveSettings();
                    this.applyReadingSettings();
                });
        });
        
        // Line spacing
        menu.addItem(item => {
            item
                .setTitle('Increase Line Spacing')
                .onClick(() => {
                    this.plugin.settings.reading.lineHeight += 0.1;
                    this.plugin.saveSettings();
                    this.applyReadingSettings();
                });
        });
        
        menu.addItem(item => {
            item
                .setTitle('Decrease Line Spacing')
                .onClick(() => {
                    this.plugin.settings.reading.lineHeight = Math.max(1.0, this.plugin.settings.reading.lineHeight - 0.1);
                    this.plugin.saveSettings();
                    this.applyReadingSettings();
                });
        });
        
        // Add bookmark
        menu.addItem(item => {
            item
                .setTitle('Add Bookmark')
                .onClick(() => {
                    this.addBookmark();
                });
        });
        
        menu.showAtMouseEvent(evt);
    }

    private showBookmarksMenu(evt: MouseEvent) {
        if (!this.readingState || this.readingState.bookmarks.length === 0) {
            new Menu()
                .addItem(item => item.setTitle('No bookmarks').setDisabled(true))
                .showAtMouseEvent(evt);
            return;
        }
        
        const menu = new Menu();
        
        // Sort bookmarks by creation date (newest first)
        const sortedBookmarks = [...this.readingState.bookmarks]
            .sort((a, b) => b.createdAt - a.createdAt);
        
        sortedBookmarks.forEach(bookmark => {
            menu.addItem(item => {
                item
                    .setTitle(bookmark.title)
                    .onClick(() => {
                        this.navigateToLocation(bookmark.chapterId, bookmark.position);
                    });
            });
        });
        
        menu.showAtMouseEvent(evt);
    }

    private showWelcomeScreen() {
        if (!this.readerEl) return;
        
        this.readerEl.empty();
        const welcomeEl = this.readerEl.createDiv({ cls: 'ebook-reader-welcome' });
        
        welcomeEl.createEl('h2', { text: 'Welcome to E-Book Reader' });
        welcomeEl.createEl('p', { 
            text: 'Open an e-book from your library or import a new one to start reading.' 
        });
        
        const btnContainer = welcomeEl.createDiv({ cls: 'ebook-reader-welcome-buttons' });
        
        const libraryBtn = btnContainer.createEl('button', {
            text: 'Open Library',
            cls: 'ebook-reader-btn ebook-reader-btn-primary'
        });
        libraryBtn.addEventListener('click', () => {
            this.plugin.openLibraryView();
        });
        
        const importBtn = btnContainer.createEl('button', {
            text: 'Import E-Book',
            cls: 'ebook-reader-btn'
        });
        importBtn.addEventListener('click', () => {
            this.plugin.importEbook();
        });
        
        // Show recent books if any
        const books = this.plugin.library.getRecentBooks(5);
        if (books.length > 0) {
            welcomeEl.createEl('h3', { text: 'Recent Books' });
            const list = welcomeEl.createEl('ul', { cls: 'ebook-reader-recent-list' });
            
            books.forEach((book: Book) => {
                const li = list.createEl('li');
                const link = li.createEl('a', {
                    text: book.title,
                    href: '#'
                });
                link.addEventListener('click', (e) => {
                    e.preventDefault();
                    this.plugin.openBookInReader(book);
                });
            });
        }
    }

    onClose(): Promise<void> {
        // Revoke all blob URLs to prevent memory leaks
        this.blobUrls.forEach(url => {
            URL.revokeObjectURL(url);
        });
        this.blobUrls = [];
        
        // Save the current reading state
        if (this.readingState && this.book) {
            this.plugin.storageManager.saveReadingState(this.book.id, this.readingState);
        }
        
        // Clean up
        this.containerDiv.empty();
        return Promise.resolve();
    }
}