// Add this to a new file named libraryView.ts

import { ItemView, WorkspaceLeaf, Menu, Notice } from 'obsidian';
import { Book } from './libraryManager';
import EbookReaderPlugin from './main';

export const LIBRARY_VIEW_TYPE = 'ebook-library-view';

export class LibraryView extends ItemView {
    private plugin: EbookReaderPlugin;
    private containerDiv: HTMLElement;
    private booksContainer: HTMLElement;
    private searchInput: HTMLInputElement;
    private filterContainer: HTMLElement;
    private sortOption: string = 'title'; // Default sort option
    private filterCriteria: Record<string, string> = {}; // Current filters

    constructor(leaf: WorkspaceLeaf, plugin: EbookReaderPlugin) {
        super(leaf);
        this.plugin = plugin;
    }

    getViewType(): string {
        return LIBRARY_VIEW_TYPE;
    }

    getDisplayText(): string {
        return 'E-Book Library';
    }

    getIcon(): string {
        return 'book';
    }

    async onOpen() {
        // Create the main container for the library
        this.containerDiv = this.containerEl.createDiv({ cls: 'ebook-library-container' });
        
        // Create header with search and filters
        this.createHeader();
        
        // Create books grid
        this.booksContainer = this.containerDiv.createDiv({ cls: 'ebook-library-grid' });
        
        // Register for library updates
        this.plugin.library.onLibraryChanged(() => {
            this.renderBooks();
        });

        // Add drag and drop handlers
        this.setupDragAndDrop();
        
        // Render the books
        this.renderBooks();
    }

    private setupDragAndDrop() {
        const handleDragEvent = (e: DragEvent) => {
            e.preventDefault();
            e.stopPropagation();
        };

        this.containerEl.addEventListener('dragenter', (e) => {
            handleDragEvent(e);
            this.containerEl.addClass('ebook-library-dragover');
        });

        this.containerEl.addEventListener('dragover', (e) => {
            handleDragEvent(e);
            this.containerEl.addClass('ebook-library-dragover');
        });

        this.containerEl.addEventListener('dragleave', (e) => {
            handleDragEvent(e);
            if (!this.containerEl.contains(e.relatedTarget as Node)) {
                this.containerEl.removeClass('ebook-library-dragover');
            }
        });

        this.containerEl.addEventListener('drop', async (e) => {
            handleDragEvent(e);
            this.containerEl.removeClass('ebook-library-dragover');

            const files = e.dataTransfer?.files;
            if (files && files.length > 0) {
                let importCount = 0;
                for (let i = 0; i < files.length; i++) {
                    const file = files[i];
                    if (file.name.toLowerCase().endsWith('.epub')) {
                        await this.plugin.importEbookFile(file);
                        importCount++;
                    }
                }
                
                if (importCount > 0) {
                    new Notice(`Successfully imported ${importCount} book${importCount > 1 ? 's' : ''}`);
                }
            }
        });
    }

    private createHeader() {
        const headerEl = this.containerDiv.createDiv({ cls: 'ebook-library-header' });
        
        // Title and buttons container
        const titleContainer = headerEl.createDiv({ cls: 'ebook-library-title-container' });
        titleContainer.createEl('h2', { text: 'E-Book Library' });
    
        // Add refresh button
        const refreshBtn = titleContainer.createEl('button', {
            cls: 'ebook-library-btn ebook-library-btn-icon',
            attr: { 'aria-label': 'Refresh Library' }
        });
        refreshBtn.innerHTML = '<svg viewBox="0 0 100 100" class="refresh-icon"><path d="M20,50 A30,30 0 1,1 80,50 M80,50 L80,30 M80,50 L60,50"></path></svg>';
        refreshBtn.addEventListener('click', async () => {
            new Notice('Scanning library folder for books...');
            await this.plugin.library.scanLibraryFolder();
        });
    
        // Import button
        const importBtn = titleContainer.createEl('button', {
            text: 'Import E-Book',
            cls: 'ebook-library-btn ebook-library-btn-primary'
        });
        importBtn.addEventListener('click', () => {
            this.plugin.importEbook();
        });
        
        // Filter and sort container
        this.filterContainer = headerEl.createDiv({ cls: 'ebook-library-filters' });
        // Sort dropdown
        const sortLabel = this.filterContainer.createSpan({ text: 'Sort by: ' });
        const sortSelect = this.filterContainer.createEl('select', { cls: 'ebook-library-sort' });
        
        const sortOptions = [
            { value: 'title', text: 'Title' },
            { value: 'author', text: 'Author' },
            { value: 'addedDate', text: 'Date Added' },
            { value: 'lastOpenedDate', text: 'Last Read' }
        ];
        
        sortOptions.forEach(option => {
            const optionEl = sortSelect.createEl('option', {
                value: option.value,
                text: option.text
            });
            
            if (option.value === this.sortOption) {
                optionEl.selected = true;
            }
        });
        
        sortSelect.addEventListener('change', () => {
            this.sortOption = sortSelect.value;
            this.renderBooks();
        });
        
        // Populate author and tag filters
        this.updateFilters();
    }

    private updateFilters() {
        if (!this.filterContainer) return;
        
        // Clear existing filter dropdowns
        const existingFilters = this.filterContainer.querySelectorAll('.ebook-library-filter');
        existingFilters.forEach(filter => filter.remove());
        
        // Add author filter
        const authors = this.plugin.library.getAuthors();
        if (authors.length > 0) {
            this.addFilterDropdown('author', 'Author', authors);
        }
        
        // Add tag filter
        const tags = this.plugin.library.getTags();
        if (tags.length > 0) {
            this.addFilterDropdown('tag', 'Tag', tags);
        }
    }

    private addFilterDropdown(key: string, label: string, options: string[]) {
        const container = this.filterContainer.createDiv({ cls: 'ebook-library-filter' });
        
        container.createSpan({ text: `${label}: ` });
        const select = container.createEl('select');
        
        // Add default "All" option
        const defaultOption = select.createEl('option', {
            value: '',
            text: `All ${label}s`
        });
        defaultOption.selected = !this.filterCriteria[key];
        
        // Add all options
        options.forEach(option => {
            const optionEl = select.createEl('option', {
                value: option,
                text: option
            });
            
            if (this.filterCriteria[key] === option) {
                optionEl.selected = true;
            }
        });
        
        select.addEventListener('change', () => {
            if (select.value) {
                this.filterCriteria[key] = select.value;
            } else {
                delete this.filterCriteria[key];
            }
            this.renderBooks();
        });
    }

    private renderBooks() {
        if (!this.booksContainer) return;
        
        // Clear current books
        this.booksContainer.empty();
        
        // Get books
        let books = this.plugin.library.getAllBooks();
        
        // Apply search filter if there's a search term
        const searchTerm = this.searchInput?.value;
        if (searchTerm) {
            books = this.plugin.library.searchBooks(searchTerm);
        }
        
        // Apply other filters
        if (Object.keys(this.filterCriteria).length > 0) {
            books = this.plugin.library.filterBooks(this.filterCriteria);
        }
        
        // Sort books
        books.sort((a, b) => {
            switch(this.sortOption) {
                case 'author':
                    return a.author.localeCompare(b.author);
                case 'addedDate':
                    return b.addedDate - a.addedDate;
                case 'lastOpenedDate':
                    return b.lastOpenedDate - a.lastOpenedDate;
                case 'title':
                default:
                    return a.title.localeCompare(b.title);
            }
        });
        
        // Display books
        if (books.length === 0) {
            this.booksContainer.createEl('p', { 
                text: 'No books found. Import some e-books to get started!',
                cls: 'ebook-library-empty'
            });
            return;
        }
        
        // Create book cards
        books.forEach(book => {
            this.createBookCard(book);
        });
    }

    private createBookCard(book: Book) {
        const card = this.booksContainer.createDiv({ cls: 'ebook-book-card' });
        
        // Cover image or placeholder
        const coverContainer = card.createDiv({ cls: 'ebook-book-cover' });
        
        if (book.coverPath) {
            const coverImg = coverContainer.createEl('img', {
                attr: { src: this.plugin.app.vault.adapter.getResourcePath(book.coverPath) }
            });
        } else {
            // Placeholder for books without covers
            const placeholderEl = coverContainer.createDiv({ cls: 'ebook-book-cover-placeholder' });
            const titleInitial = book.title.charAt(0).toUpperCase();
            placeholderEl.createSpan({ text: titleInitial });
        }
        
        // Progress bar
        if (book.progress > 0) {
            const progressContainer = coverContainer.createDiv({ cls: 'ebook-book-progress' });
            const progressBar = progressContainer.createDiv({ cls: 'ebook-book-progress-bar' });
            progressBar.style.width = `${book.progress}%`;
        }
        
        // Book info
        const infoEl = card.createDiv({ cls: 'ebook-book-info' });
        infoEl.createDiv({ text: book.title, cls: 'ebook-book-title' });
        infoEl.createDiv({ text: book.author, cls: 'ebook-book-author' });
        
        // Tags
        if (book.tags && book.tags.length > 0) {
            const tagsContainer = infoEl.createDiv({ cls: 'ebook-book-tags' });
            book.tags.slice(0, 3).forEach(tag => { // Show up to 3 tags
                tagsContainer.createSpan({ text: tag, cls: 'ebook-book-tag' });
            });
        }
        
        // Click handler to open the book
        card.addEventListener('click', () => {
            this.plugin.openBookInReader(book);
        });
        
        // Context menu for more options
        card.addEventListener('contextmenu', (event) => {
            const menu = new Menu();
            
            menu.addItem(item => {
                item
                    .setTitle('Open Book')
                    .onClick(() => {
                        this.plugin.openBookInReader(book);
                    });
            });
            
            menu.addItem(item => {
                item
                    .setTitle('Remove from Library')
                    .onClick(async () => {
                        const confirmed = confirm(`Are you sure you want to remove "${book.title}" from your library?`);
                        if (confirmed) {
                            await this.plugin.library.removeBook(book.id);
                        }
                    });
            });
            
            menu.showAtMouseEvent(event);
        });
    }

    async onClose() {
        // Clean up
        this.containerDiv.empty();
        return Promise.resolve();
    }
}