import EbookReaderPlugin from './main';
import { Book, Collection } from './libraryManager';
import { ReadingState } from './readerView';

interface StorageData {
    books?: Book[];
    collections?: Collection[];
    readingStates?: Record<string, ReadingState>;
}

export class LocalStorageManager {
    private plugin: EbookReaderPlugin;
    private readonly LAST_READ_BOOK_KEY = 'ebook-reader-last-book';

    constructor(plugin: EbookReaderPlugin) {
        this.plugin = plugin;
    }

    /**
     * Save the library of books to local storage
     */
    async saveBooks(books: Book[]): Promise<void> {
        const data = await this.loadAllData();
        data.books = books;
        await this.saveAllData(data);
    }

    /**
     * Load the library of books from local storage
     */
    async getBooks(): Promise<Book[] | null> {
        const data = await this.loadAllData();
        return data.books || null;
    }

    /**
     * Save collections to local storage
     */
    async saveCollections(collections: Collection[]): Promise<void> {
        const data = await this.loadAllData();
        data.collections = collections;
        await this.saveAllData(data);
    }

    /**
     * Load collections from local storage
     */
    async getCollections(): Promise<Collection[] | null> {
        const data = await this.loadAllData();
        return data.collections || null;
    }

    /**
     * Save reading state for a specific book
     */
    async saveReadingState(bookId: string, state: ReadingState): Promise<void> {
        const data = await this.loadAllData();
        
        if (!data.readingStates) {
            data.readingStates = {};
        }
        
        data.readingStates[bookId] = state;
        await this.saveAllData(data);
    }

    /**
     * Get reading state for a specific book
     */
    async getReadingState(bookId: string): Promise<ReadingState | null> {
        const data = await this.loadAllData();
        return data.readingStates?.[bookId] || null;
    }

    /**
     * Get all reading states
     */
    private async getAllReadingStates(): Promise<Record<string, ReadingState>> {
        const data = await this.loadAllData();
        return data.readingStates || {};
    }

    /**
     * Load all data from storage
     */
    private async loadAllData(): Promise<StorageData> {
        try {
            const data = await this.plugin.loadData();
            return data || {};
        } catch (e) {
            console.error("Error loading data:", e);
            return {};
        }
    }

    /**
     * Save all data to storage
     */
    private async saveAllData(data: StorageData): Promise<void> {
        try {
            await this.plugin.saveData(data);
        } catch (e) {
            console.error("Error saving data:", e);
        }
    }

    /**
     * Set the last read book
     */
    setLastReadBook(bookId: string): void {
        localStorage.setItem(this.LAST_READ_BOOK_KEY, bookId);
    }

    /**
     * Get the last read book ID
     */
    getLastReadBook(): string | null {
        return localStorage.getItem(this.LAST_READ_BOOK_KEY);
    }

    /**
     * Delete all reading data for a book
     */
    async deleteBookData(bookId: string): Promise<void> {
        const data = await this.loadAllData();
        
        if (data.readingStates && data.readingStates[bookId]) {
            delete data.readingStates[bookId];
            await this.saveAllData(data);
        }
        
        // Clear last read book if it matches
        if (this.getLastReadBook() === bookId) {
            localStorage.removeItem(this.LAST_READ_BOOK_KEY);
        }
    }

    /**
     * Export all data as JSON
     */
    async exportData(): Promise<string> {
        const data = await this.loadAllData();
        
        const exportData = {
            books: data.books || [],
            collections: data.collections || [],
            readingStates: data.readingStates || {},
            version: 1  // For future compatibility
        };
        
        return JSON.stringify(exportData, null, 2);
    }

    /**
     * Import data from JSON
     */
    async importData(jsonData: string): Promise<boolean> {
        try {
            const importedData = JSON.parse(jsonData);
            
            // Verify data structure
            if (!importedData.books || !Array.isArray(importedData.books) || 
                !importedData.collections || !Array.isArray(importedData.collections) ||
                !importedData.readingStates || typeof importedData.readingStates !== 'object') {
                throw new Error('Invalid data format');
            }
            
            const data: StorageData = {
                books: importedData.books,
                collections: importedData.collections,
                readingStates: importedData.readingStates
            };
            
            await this.saveAllData(data);
            
            return true;
        } catch (error) {
            console.error('Error importing data:', error);
            return false;
        }
    }
}