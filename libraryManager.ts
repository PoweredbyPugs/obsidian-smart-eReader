import { TFile, TFolder, Notice } from 'obsidian';
import EbookReaderPlugin from './main';
import { parseEpub } from './epubParser';


export type LibrarySource = 'local' | 'dropbox' | 'googleDrive' | 'oneDrive' | 'calibre';

export interface Book {
    id: string;
    title: string;
    author: string;
    path: string;
    coverPath: string;
    addedDate: number;
    lastOpenedDate: number;
    progress: number;
    source: LibrarySource;
    tags?: string[];
    series?: string;
    seriesIndex?: number;
    collections?: string[];
    description?: string;
    language?: string;
    publisher?: string;
    publishDate?: string;
    isbn?: string;
    fileSize?: number;
    rating?: number;
}

export interface Collection {
    id: string;
    name: string;
    description?: string;
    books: string[]; // Array of book IDs
    createdDate: number;
    updatedDate: number;
}

export class BookLibrary {
    private plugin: EbookReaderPlugin;
    private books: Map<string, Book> = new Map();
    private collections: Map<string, Collection> = new Map();
    private eventHandlers: Array<() => void> = [];

    constructor(plugin: EbookReaderPlugin) {
        this.plugin = plugin;
    }

    async initialize(): Promise<void> {
        console.log("Initializing library...");
        // Load books from storage
        const savedBooks = await this.plugin.storageManager.getBooks();
        if (savedBooks) {
            console.log(`Loading ${savedBooks.length} books from storage`);
            savedBooks.forEach((book: Book) => {
                this.books.set(book.id, book);
            });
        } else {
            console.log("No saved books found in storage");
        }
    
        // Load collections from storage
        const savedCollections = await this.plugin.storageManager.getCollections();
        if (savedCollections) {
            console.log(`Loading ${savedCollections.length} collections from storage`);
            savedCollections.forEach((collection: Collection) => {
                this.collections.set(collection.id, collection);
            });
        } else {
            console.log("No saved collections found in storage");
        }
    
        // Check if library folder exists before scanning
        const libraryFolder = this.plugin.app.vault.getAbstractFileByPath(this.plugin.settings.libraryPath);
        
        // Automatically scan the library folder for new books if the folder exists
        if (libraryFolder instanceof TFolder) {
            console.log("Will scan library folder for books");
            // Use a delay to ensure the app is fully loaded
            setTimeout(() => {
                console.log("Starting delayed library scan...");
                this.scanLibraryFolder();
            }, 3000); // 3 second delay
        } else {
            console.log("Library folder not found, skipping automatic scan");
        }
    
        console.log("Library initialization completed");
    }

    async scanLibraryFolder(): Promise<void> {
        console.log("Starting library scan...");
        
        // Get the library folder
        const folder = this.plugin.app.vault.getAbstractFileByPath(this.plugin.settings.libraryPath);
        console.log("Library folder check result:", folder ? "Found" : "Not found", 
                    "Path:", this.plugin.settings.libraryPath);
        
        if (!(folder instanceof TFolder)) {
            console.error(`Library folder not found or not a folder: ${this.plugin.settings.libraryPath}`);
            new Notice(`Failed to access library folder: ${this.plugin.settings.libraryPath}`);
            return;
        }
    
        try {
            // Find all EPUB files
            console.log("Searching for EPUB files...");
            const epubFiles = this.getEpubFilesInFolder(folder);
            console.log(`Found ${epubFiles.length} EPUB files in library folder:`, 
                        epubFiles.map(f => f.path));
    
            // Track new books added for notification
            let newBooksAdded = 0;
    
            // Check if there are any new files that aren't in the library yet
            for (const file of epubFiles) {
                try {
                    // Check if this file is already in the library
                    const existingBook = this.getBookByPath(file.path);
                    if (!existingBook) {
                        // Add the book to the library
                        console.log(`Processing new book: ${file.path}`);
                        const newBook = await this.addBookFromFile(file);
                        if (newBook) {
                            console.log(`Successfully added book: ${newBook.title}`);
                            newBooksAdded++;
                        } else {
                            console.error(`Failed to add book: ${file.path}`);
                        }
                    } else {
                        console.log(`Book already in library: ${file.path}`);
                    }
                } catch (error) {
                    console.error(`Error processing book ${file.path}:`, error);
                }
            }
    
            // Check for books that no longer exist in the filesystem
            const booksToRemove: string[] = [];
            for (const book of this.books.values()) {
                if (book.source === 'local') {
                    const file = this.plugin.app.vault.getAbstractFileByPath(book.path);
                    if (!file) {
                        console.log(`Book no longer exists: ${book.path}`);
                        booksToRemove.push(book.id);
                    }
                }
            }
    
            // Remove books that no longer exist
            for (const bookId of booksToRemove) {
                await this.removeBook(bookId);
            }
    
            // Notify the user of changes
            if (newBooksAdded > 0) {
                new Notice(`Added ${newBooksAdded} new books to your library.`);
            } else if (epubFiles.length > 0) {
                console.log("No new books added - all EPUBs already in library");
            } else {
                console.log("No EPUB files found in library folder");
            }
            
            if (booksToRemove.length > 0) {
                new Notice(`Removed ${booksToRemove.length} books that no longer exist.`);
            }
    
            // Save the updated library
            await this.saveLibrary();
            this.notifyListeners();
            console.log("Library scan completed successfully");
        } catch (error) {
            console.error("Error during library scan:", error);
            new Notice("Error scanning library: " + error.message);
        }
    }

    private getEpubFilesInFolder(folder: TFolder): TFile[] {
        console.log(`Searching for EPUBs in folder: ${folder.path}`);
        const epubFiles: TFile[] = [];
    
        // Recursively find all EPUB files
        const findEpubs = (folder: TFolder) => {
            console.log(`Checking folder: ${folder.path}, children: ${folder.children.length}`);
            for (const child of folder.children) {
                if (child instanceof TFile && child.extension === 'epub') {
                    console.log(`Found EPUB: ${child.path}`);
                    epubFiles.push(child);
                } else if (child instanceof TFolder) {
                    console.log(`Recursing into subfolder: ${child.path}`);
                    findEpubs(child);
                }
            }
        };
    
        try {
            findEpubs(folder);
            console.log(`Found ${epubFiles.length} EPUB files`);
        } catch (error) {
            console.error("Error searching for EPUBs:", error);
        }
        
        return epubFiles;
    }

    async addBookFromFile(file: TFile): Promise<Book | null> {
        try {
            console.log(`Reading file data for: ${file.path}`);
            // Read the file data
            const data = await this.plugin.app.vault.readBinary(file);
            console.log(`File size: ${data.byteLength} bytes`);
            
            // Parse the EPUB to get metadata
            console.log(`Parsing EPUB metadata for: ${file.path}`);
            const epubContent = await parseEpub(data);
            console.log(`EPUB metadata parsed successfully for: ${file.path}`);
            
            // Create a new book object
            const book: Book = {
                id: this.generateBookId(),
                title: epubContent.metadata.title || file.basename,
                author: epubContent.metadata.creator || 'Unknown',
                path: file.path,
                coverPath: '',
                addedDate: Date.now(),
                lastOpenedDate: Date.now(),
                progress: 0,
                source: 'local',
                publisher: epubContent.metadata.publisher,
                language: epubContent.metadata.language,
                publishDate: epubContent.metadata.published
            };
            
            console.log(`Created book object: ${book.title} by ${book.author}`);
            
            // Extract and save cover if available
            if (epubContent.coverPath) {
                console.log(`Extracting cover from: ${epubContent.coverPath}`);
                book.coverPath = await this.plugin.extractAndSaveCover(epubContent, book.id);
                console.log(`Cover saved to: ${book.coverPath}`);
            }
            
            // Add to library
            console.log(`Adding book to library: ${book.title}`);
            await this.addBook(book);
            return book;
        } catch (error) {
            console.error(`Error adding book from file ${file.path}:`, error);
            new Notice(`Error adding book ${file.name}: ${error.message}`);
            return null;
        }
    }

    generateBookId(): string {
        return `book_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    // Get a book by its ID
    getBook(id: string): Book | undefined {
        return this.books.get(id);
    }

    // Get a book by its path
    getBookByPath(path: string): Book | undefined {
        for (const book of this.books.values()) {
            if (book.path === path) {
                return book;
            }
        }
        return undefined;
    }

    // Add a book to the library
    async addBook(book: Book): Promise<void> {
        this.books.set(book.id, book);
        await this.saveLibrary();
        this.notifyListeners();
    }

    // Update an existing book
    async updateBook(book: Book): Promise<void> {
        if (this.books.has(book.id)) {
            this.books.set(book.id, book);
            await this.saveLibrary();
            this.notifyListeners();
        }
    }

    // Remove a book from the library
    async removeBook(id: string): Promise<void> {
        if (this.books.has(id)) {
            this.books.delete(id);
            await this.saveLibrary();
            this.notifyListeners();
        }
    }

    // Get all books
    getAllBooks(): Book[] {
        return Array.from(this.books.values());
    }

    // Get recently opened books
    getRecentBooks(limit: number = 10): Book[] {
        return Array.from(this.books.values())
            .sort((a, b) => b.lastOpenedDate - a.lastOpenedDate)
            .slice(0, limit);
    }

    // Search books by title, author, etc.
    searchBooks(query: string): Book[] {
        const normalizedQuery = query.toLowerCase();
        return Array.from(this.books.values()).filter(book => {
            return (
                book.title.toLowerCase().includes(normalizedQuery) ||
                book.author.toLowerCase().includes(normalizedQuery) ||
                (book.series && book.series.toLowerCase().includes(normalizedQuery)) ||
                (book.tags && book.tags.some(tag => tag.toLowerCase().includes(normalizedQuery)))
            );
        });
    }

    // Filter books by various criteria
    filterBooks(criteria: {
        author?: string;
        series?: string;
        tag?: string;
        collection?: string;
        source?: LibrarySource;
    }): Book[] {
        return Array.from(this.books.values()).filter(book => {
            if (criteria.author && book.author !== criteria.author) return false;
            if (criteria.series && book.series !== criteria.series) return false;
            if (criteria.tag && (!book.tags || !book.tags.includes(criteria.tag))) return false;
            if (criteria.source && book.source !== criteria.source) return false;
            if (criteria.collection) {
                const collection = this.collections.get(criteria.collection);
                if (!collection || !collection.books.includes(book.id)) return false;
            }
            return true;
        });
    }

    // Get all unique authors
    getAuthors(): string[] {
        const authors = new Set<string>();
        for (const book of this.books.values()) {
            authors.add(book.author);
        }
        return Array.from(authors).sort();
    }

    // Get all unique series
    getSeries(): string[] {
        const series = new Set<string>();
        for (const book of this.books.values()) {
            if (book.series) {
                series.add(book.series);
            }
        }
        return Array.from(series).sort();
    }

    // Get all unique tags
    getTags(): string[] {
        const tags = new Set<string>();
        for (const book of this.books.values()) {
            if (book.tags) {
                for (const tag of book.tags) {
                    tags.add(tag);
                }
            }
        }
        return Array.from(tags).sort();
    }

    // Add a tag to a book
    async addTagToBook(bookId: string, tag: string): Promise<void> {
        const book = this.books.get(bookId);
        if (book) {
            if (!book.tags) {
                book.tags = [];
            }
            if (!book.tags.includes(tag)) {
                book.tags.push(tag);
                await this.updateBook(book);
            }
        }
    }

    // Remove a tag from a book
    async removeTagFromBook(bookId: string, tag: string): Promise<void> {
        const book = this.books.get(bookId);
        if (book && book.tags) {
            const index = book.tags.indexOf(tag);
            if (index !== -1) {
                book.tags.splice(index, 1);
                await this.updateBook(book);
            }
        }
    }

    // Create a new collection
    async createCollection(name: string, description?: string): Promise<Collection> {
        const collection: Collection = {
            id: `collection_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            name,
            description,
            books: [],
            createdDate: Date.now(),
            updatedDate: Date.now()
        };
        this.collections.set(collection.id, collection);
        await this.saveLibrary();
        this.notifyListeners();
        return collection;
    }

    // Get a collection by ID
    getCollection(id: string): Collection | undefined {
        return this.collections.get(id);
    }

    // Update a collection
    async updateCollection(collection: Collection): Promise<void> {
        if (this.collections.has(collection.id)) {
            collection.updatedDate = Date.now();
            this.collections.set(collection.id, collection);
            await this.saveLibrary();
            this.notifyListeners();
        }
    }

    // Delete a collection
    async deleteCollection(id: string): Promise<void> {
        if (this.collections.has(id)) {
            this.collections.delete(id);
            await this.saveLibrary();
            this.notifyListeners();
        }
    }

    // Add a book to a collection
    async addBookToCollection(bookId: string, collectionId: string): Promise<boolean> {
        const book = this.books.get(bookId);
        const collection = this.collections.get(collectionId);
        
        if (book && collection) {
            if (!collection.books.includes(bookId)) {
                collection.books.push(bookId);
                collection.updatedDate = Date.now();
                await this.saveLibrary();
                this.notifyListeners();
                return true;
            }
        }
        return false;
    }

    // Remove a book from a collection
    async removeBookFromCollection(bookId: string, collectionId: string): Promise<boolean> {
        const collection = this.collections.get(collectionId);
        
        if (collection) {
            const index = collection.books.indexOf(bookId);
            if (index !== -1) {
                collection.books.splice(index, 1);
                collection.updatedDate = Date.now();
                await this.saveLibrary();
                this.notifyListeners();
                return true;
            }
        }
        return false;
    }

    // Get all collections
    getAllCollections(): Collection[] {
        return Array.from(this.collections.values());
    }

    // Get collections containing a specific book
    getCollectionsForBook(bookId: string): Collection[] {
        return Array.from(this.collections.values())
            .filter(collection => collection.books.includes(bookId));
    }

    // Save the library to storage
    private async saveLibrary(): Promise<void> {
        await this.plugin.storageManager.saveBooks(Array.from(this.books.values()));
        await this.plugin.storageManager.saveCollections(Array.from(this.collections.values()));
    }

    // Register an event listener
    onLibraryChanged(callback: () => void): void {
        this.eventHandlers.push(callback);
    }

    // Notify all event listeners
    private notifyListeners(): void {
        for (const handler of this.eventHandlers) {
            handler();
        }
    }

    // Refresh the library (e.g., after import)
    refresh(): void {
        this.notifyListeners();
    }
}