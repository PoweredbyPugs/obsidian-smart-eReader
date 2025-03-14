import { App, Plugin, PluginSettingTab, Setting, TFile, WorkspaceLeaf, TFolder, Notice } from 'obsidian';
import * as JSZip from 'jszip';
import { parseEpub, EpubContent, EpubMetadata } from './epubParser';
import { BookLibrary, Book, LibrarySource } from './libraryManager';
import { ReaderView, READER_VIEW_TYPE, ReadingState } from './readerView';
import { LibraryView, LIBRARY_VIEW_TYPE } from './libraryView';
import { LocalStorageManager } from './storageManager';
import { CloudSyncManager } from './cloudSync';

interface EbookReaderSettings {
	libraryPath: string;
	cloudServices: {
		dropbox: {
			enabled: boolean;
			apiKey: string;
		},
		googleDrive: {
			enabled: boolean;
			clientId: string;
		},
		oneDrive: {
			enabled: boolean;
			clientId: string;
		}
	};
	reading: {
		fontSize: number;
		lineHeight: number;
		theme: 'light' | 'dark' | 'sepia';
		fontFamily: string;
		margins: number;
		pageTurnAnimation: boolean;
	};
	sync: {
		enabled: boolean;
		syncBookmarks: boolean;
		syncHighlights: boolean;
		syncReadingProgress: boolean;
		syncNotes: boolean;
	};
}

const DEFAULT_SETTINGS: EbookReaderSettings = {
	libraryPath: 'Books',
	cloudServices: {
		dropbox: {
			enabled: false,
			apiKey: '',
		},
		googleDrive: {
			enabled: false,
			clientId: '',
		},
		oneDrive: {
			enabled: false,
			clientId: '',
		}
	},
	reading: {
		fontSize: 16,
		lineHeight: 1.5,
		theme: 'light',
		fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
		margins: 2,
		pageTurnAnimation: true,
	},
	sync: {
		enabled: true,
		syncBookmarks: true,
		syncHighlights: true,
		syncReadingProgress: true,
		syncNotes: true,
	}
};

export default class EbookReaderPlugin extends Plugin {
	settings: EbookReaderSettings;
	library: BookLibrary;
	storageManager: LocalStorageManager;
	cloudSync: CloudSyncManager;

	async onload() {
		await this.loadSettings();
		this.initializeManagers();
		this.registerViews();
		this.registerCommands();
		this.registerFileHandlers();
		this.addSettingTab(new EbookReaderSettingTab(this.app, this));
		
		// Check library folder quietly - no error notification on startup
		const libraryFolder = this.app.vault.getAbstractFileByPath(this.settings.libraryPath);
		const folderExists = libraryFolder instanceof TFolder;
		console.log(`Library folder check during plugin load: ${folderExists ? "Found" : "Not found"} at ${this.settings.libraryPath}`);
		
		// Only create resource folders if the main folder exists
		if (folderExists) {
			// Create resources folder if it doesn't exist
			const resourcesPath = `${this.settings.libraryPath}/.resources`;
			const resourcesFolder = this.app.vault.getAbstractFileByPath(resourcesPath);
			if (!resourcesFolder) {
				try {
					await this.app.vault.createFolder(resourcesPath);
					console.log("Created resources folder:", resourcesPath);
				} catch (e) {
					console.error("Error creating resources folder:", e);
				}
			}
			
			// Create covers folder if it doesn't exist
			const coversPath = `${this.settings.libraryPath}/.covers`;
			const coversFolder = this.app.vault.getAbstractFileByPath(coversPath);
			if (!coversFolder) {
				try {
					await this.app.vault.createFolder(coversPath);
					console.log("Created covers folder:", coversPath);
				} catch (e) {
					console.error("Error creating covers folder:", e);
				}
			}
		}
		
		// Initialize the library
		await this.library.initialize();
		
		console.log('Ebook Reader plugin loaded');
	}
	async initializeManagers() {
		// Initialize storage manager for local data
		this.storageManager = new LocalStorageManager(this);
		
		// Initialize cloud sync manager
		this.cloudSync = new CloudSyncManager(this);
		
		// Initialize book library
		this.library = new BookLibrary(this);
	}

	registerViews() {
		// Register the custom reader view
		this.registerView(
			READER_VIEW_TYPE,
			(leaf) => new ReaderView(leaf, this)
		);
		
		// Register the library view
		this.registerView(
			LIBRARY_VIEW_TYPE,
			(leaf) => new LibraryView(leaf, this)
		);
		
		// Add ribbon icon to open library
		this.addRibbonIcon('book', 'Open E-Book Library', () => {
			this.openLibraryView();
		});
	}

	registerCommands() {
		// Command to open the library view
		this.addCommand({
			id: 'open-ebook-library',
			name: 'Open E-Book Library',
			callback: () => {
				this.openLibraryView();
			}
		});
		
		// Command to import an e-book
		this.addCommand({
			id: 'import-ebook',
			name: 'Import E-Book',
			callback: () => {
				this.importEbook();
			}
		});
		
		// Command to sync with cloud services
		this.addCommand({
			id: 'sync-ebooks',
			name: 'Sync E-Books with Cloud',
			callback: () => {
				this.cloudSync.syncAll();
			}
		});
		
		// Command to open reader view for the current book
		this.addCommand({
			id: 'continue-reading',
			name: 'Continue Reading Last Book',
			callback: () => {
				const lastBookId = this.storageManager.getLastReadBook();
				if (lastBookId) {
					const book = this.library.getBook(lastBookId);
					if (book) {
						this.openBookInReader(book);
					}
				}
			}
		});
	}

	registerFileHandlers() {
		// Register .epub file extension handler
		this.registerExtensions(['epub'], 'ebook');
		
		// Register event handler for opening .epub files
		this.app.workspace.on('file-open', (file: TFile) => {
			if (file.extension === 'epub') {
				// Prevent default opening and use our reader instead
				this.openBookFromFile(file);
				return false;
			}
		});
	}

	async openBookFromFile(file: TFile) {
		// Check if the book is already in the library
		let book = this.library.getBookByPath(file.path);
		
		if (!book) {
			// If not in library, add it
			const fileContent = await this.app.vault.readBinary(file);
			const epubContent = await parseEpub(fileContent);
			
			book = {
				id: this.generateBookId(),
				title: epubContent.metadata.title || file.basename,
				author: epubContent.metadata.creator || 'Unknown',
				path: file.path,
				coverPath: '',
				addedDate: Date.now(),
				lastOpenedDate: Date.now(),
				progress: 0,
				source: 'local' as LibrarySource
			};
			
			// Extract and save cover if available
			if (epubContent.coverPath) {
				book.coverPath = await this.extractAndSaveCover(epubContent, book.id);
			}
			
			// Add to library
			await this.library.addBook(book);
		}
		
		// Open the book in reader view
		this.openBookInReader(book);
	}

	async openBookInReader(book: Book) {
		// Update last opened date
		book.lastOpenedDate = Date.now();
		await this.library.updateBook(book);
		
		// Store as last read book
		this.storageManager.setLastReadBook(book.id);
		
		// Get or create the reader leaf
		const leaf = this.getReaderLeaf();
		
		// Set the reader to display this book
		if (leaf && leaf.view instanceof ReaderView) {
			await leaf.view.loadBook(book);
			this.app.workspace.revealLeaf(leaf);
		}
	}

	getReaderLeaf(): WorkspaceLeaf {
		// Look for an existing reader view
		const leaves = this.app.workspace.getLeavesOfType(READER_VIEW_TYPE);
		
		if (leaves.length > 0) {
			return leaves[0];
		}
		
		// If no existing view, create a new one in the main window area (not right sidebar)
		const leaf = this.app.workspace.getLeaf('tab'); // Use 'tab' to open in the main window
		if (leaf) {
			leaf.setViewState({
				type: READER_VIEW_TYPE,
				active: true,
			});
			return leaf;
		}
		
		throw new Error("Could not create reader view");
	}

	async openLibraryView() {
		const leaves = this.app.workspace.getLeavesOfType(LIBRARY_VIEW_TYPE);
		
		if (leaves.length > 0) {
			// If library view already exists, reveal it
			this.app.workspace.revealLeaf(leaves[0]);
			return;
		}
		
		// Create a new library view in the center area (main window)
		const leaf = this.app.workspace.getLeaf('tab');
		await leaf.setViewState({
			type: LIBRARY_VIEW_TYPE,
			active: true,
		});
		
		// Ensure it takes the full width
		this.app.workspace.revealLeaf(leaf);
	}

	async importEbook() {
		// Open file picker to select epub files
		const fileInput = document.createElement('input');
		fileInput.type = 'file';
		fileInput.accept = '.epub';
		fileInput.multiple = true;
		
		fileInput.addEventListener('change', async (event) => {
			const target = event.target as HTMLInputElement;
			const files = target.files;
			if (!files || files.length === 0) return;
			
			// Process each selected file
			for (let i = 0; i < files.length; i++) {
				const file = files[i];
				await this.importEbookFile(file);
			}
			
			// Refresh the library view if open
			this.library.refresh();
		});
		
		fileInput.click();
	}

	async importEbookFile(file: File) {
		try {
			// Create a buffer from the file
			const buffer = await file.arrayBuffer();
			
			// Create target path in the library folder
			const targetPath = `${this.settings.libraryPath}/${file.name}`;
			
			// Save the file to the vault
			await this.app.vault.createBinary(targetPath, new Uint8Array(buffer));
			
			// Process the newly created file
			const obsidianFile = this.app.vault.getAbstractFileByPath(targetPath);
			if (obsidianFile instanceof TFile) {
				await this.openBookFromFile(obsidianFile);
				new Notice(`Successfully imported ${file.name}`);
			}
		} catch (error) {
			console.error('Error importing file:', error);
			new Notice(`Failed to import ${file.name}: ${error.message}`);
		}
	}

	async ensureLibraryFolder(showNotice: boolean = false): Promise<boolean> {
		// Check if the library folder exists
		const folderPath = this.settings.libraryPath;
		console.log("Checking library folder:", folderPath);
		
		const folder = this.app.vault.getAbstractFileByPath(folderPath);
		
		if (!(folder instanceof TFolder)) {
			console.log("Library folder not found:", folderPath);
			
			// Only show notice if explicitly requested
			if (showNotice) {
				new Notice(
					`E-Book library folder not found at "${folderPath}". Please configure a valid folder in plugin settings.`,
					8000
				);
			}
			return false;
		}
		
		return true;
	}

	generateBookId(): string {
		// Generate a unique ID for a book
		return 'book_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
	}

	async extractAndSaveCover(epubContent: EpubContent, bookId: string): Promise<string> {
		if (!epubContent.coverPath) return '';
		
		try {
			// Check if covers folder exists, create it if needed
			const coversPath = `${this.settings.libraryPath}/.covers`;
			const coverFolder = this.app.vault.getAbstractFileByPath(coversPath);
			
			if (!coverFolder) {
				try {
					await this.app.vault.createFolder(coversPath);
					console.log("Created covers folder:", coversPath);
				} catch (e) {
					// If folder already exists error, we can ignore it
					if (!e.message.includes("already exists")) {
						throw e;
					}
				}
			}
			
			// Extract cover data from the EPUB if coverData is null
			let coverData = epubContent.coverData;
			if (!coverData && epubContent.coverPath) {
				// Try to extract the cover from the resources
				try {
					// Look for the cover in resources
					if (epubContent.resources && epubContent.coverPath in epubContent.resources) {
						coverData = epubContent.resources[epubContent.coverPath];
						console.log("Found cover in resources:", epubContent.coverPath);
					} else {
						// Look for cover using filename
						const coverFilename = epubContent.coverPath.split('/').pop() || '';
						for (const [path, data] of Object.entries(epubContent.resources || {})) {
							if (path.endsWith(coverFilename)) {
								coverData = data;
								console.log("Found cover by filename:", path);
								break;
							}
						}
					}
				} catch (e) {
					console.error("Error extracting cover from resources:", e);
				}
			}
			
			if (coverData) {
				const coverPath = `${coversPath}/${bookId}.jpg`;
				
				// Check if cover file already exists
				const existingCover = this.app.vault.getAbstractFileByPath(coverPath);
				if (existingCover) {
					// Delete existing cover file
					await this.app.vault.delete(existingCover);
					console.log("Replaced existing cover:", coverPath);
				}
				
				await this.app.vault.createBinary(coverPath, coverData);
				console.log("Saved new cover to:", coverPath);
				return coverPath;
			} else {
				console.log("No cover data available for", bookId);
			}
			
			return '';
		} catch (error) {
			console.error("Error saving cover:", error);
			return '';
		}
	}
	// Method for extracting resources from EPUBs
	async extractAndSaveResource(bookId: string, relativePath: string): Promise<string | null> {
		try {
			// Get the book
			const book = this.library.getBook(bookId);
			if (!book) return null;
			
			// Read the EPUB file
			const file = this.app.vault.getAbstractFileByPath(book.path);
			if (!(file instanceof TFile)) return null;
			
			// Read the file data
			const data = await this.app.vault.readBinary(file);
			
			// Extract the resource using JSZip
			const zip = await JSZip.loadAsync(data);
			
			// Normalize the relative path in the EPUB
			let resourcePaths = [relativePath];
			if (relativePath.startsWith('../')) {
				resourcePaths.push(relativePath.replace(/\.\.\//g, ''));
			}
			
			// Try different path variations
			let resourceData = null;
			for (const path of resourcePaths) {
				const zipFile = zip.file(path) || zip.file(path.replace(/\//g, '_'));
				if (zipFile) {
					resourceData = await zipFile.async('uint8array');
					break;
				}
			}
			
			if (!resourceData) return null;
			
			// Create resources folder if it doesn't exist
			const resourcesPath = `${this.settings.libraryPath}/.resources/${bookId}`;
			const resourcesFolder = this.app.vault.getAbstractFileByPath(resourcesPath);
			if (!resourcesFolder) {
				await this.app.vault.createFolder(resourcesPath);
			}
			
			// Save the resource
			const normalizedPath = relativePath.replace(/\.\.\//g, '').replace(/\//g, '_');
			const savePath = `${resourcesPath}/${normalizedPath}`;
			await this.app.vault.createBinary(savePath, resourceData);
			
			const savedFile = this.app.vault.getAbstractFileByPath(savePath);
			if (savedFile instanceof TFile) {
				return this.app.vault.getResourcePath(savedFile);
			}
			return null;
		} catch (e) {
			console.error('Error extracting resource:', e);
			return null;
		}
	}

	// Get a resource path (for images in EPUBs)
	getResourcePath(bookId: string, relativePath: string): string | null {
		try {
			// If we already have the image extracted and saved
			const resourcesPath = `${this.settings.libraryPath}/.resources/${bookId}`;
			const normalizedPath = relativePath.replace(/\.\.\//g, '').replace(/\//g, '_');
			const resourcePath = `${resourcesPath}/${normalizedPath}`;
			
			// Check if the resource exists
			const file = this.app.vault.getAbstractFileByPath(resourcePath);
			if (file instanceof TFile) {
				return this.app.vault.getResourcePath(file);
			}
			
			// Extract and save the resource
			this.extractAndSaveResource(bookId, relativePath);
			return null;
		} catch (e) {
			console.error('Error getting resource path:', e);
			return null;
		}
	}

	// Method for error notification
	notifyError(message: string): Notice {
		// Use Obsidian's notice API
		return new Notice(message);
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	onunload() {
		console.log('Ebook Reader plugin unloaded');
	}
}

class EbookReaderSettingTab extends PluginSettingTab {
	plugin: EbookReaderPlugin;

	constructor(app: App, plugin: EbookReaderPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const {containerEl} = this;
		containerEl.empty();
	
		containerEl.createEl('h2', {text: 'E-Book Reader Settings'});
	
		// Library Settings
		containerEl.createEl('h3', {text: 'Library Settings'});
		
		const libraryPathSetting = new Setting(containerEl)
			.setName('Library Path')
			.setDesc('The folder where your e-books will be stored')
			.addText(text => text
				.setPlaceholder('Books')
				.setValue(this.plugin.settings.libraryPath)
				.onChange(async (value) => {
					this.plugin.settings.libraryPath = value;
					await this.plugin.saveSettings();
				}));
		
		// Check if the library folder exists
		const libraryFolder = this.plugin.app.vault.getAbstractFileByPath(this.plugin.settings.libraryPath);
		if (!libraryFolder) {
			// Add a button to create the library folder
			libraryPathSetting.addButton(button => {
				button
					.setButtonText('Create Folder')
					.setCta()
					.onClick(async () => {
						try {
							// Split path and create each folder if needed
							const pathParts = this.plugin.settings.libraryPath.split('/');
							let currentPath = '';
							
							for (const part of pathParts) {
								if (currentPath) currentPath += '/';
								currentPath += part;
								
								const exists = this.plugin.app.vault.getAbstractFileByPath(currentPath);
								if (!exists) {
									await this.plugin.app.vault.createFolder(currentPath);
									console.log("Created folder:", currentPath);
								}
							}
							
							// Create resources and covers subfolders
							await this.plugin.app.vault.createFolder(`${this.plugin.settings.libraryPath}/.resources`);
							await this.plugin.app.vault.createFolder(`${this.plugin.settings.libraryPath}/.covers`);
							
							new Notice(`Library folder created successfully at ${this.plugin.settings.libraryPath}`);
							
							// Force redraw of the settings panel to update the UI
							this.display();
							
							// Trigger a library scan
							setTimeout(() => {
								this.plugin.library.scanLibraryFolder();
							}, 500);
							
						} catch (e) {
							console.error("Error creating folder structure:", e);
							new Notice(`Error creating folder: ${e.message}`);
						}
					});
			});
			
			// Add a warning message
			containerEl.createEl('div', {
				text: `Warning: The library folder "${this.plugin.settings.libraryPath}" does not exist. Please create it or choose an existing folder.`,
				cls: 'ebook-library-warning'
			});
		} else {
			// Add a scan button if the folder exists
			libraryPathSetting.addButton(button => {
				button
					.setButtonText('Scan for Books')
					.onClick(async () => {
						new Notice('Scanning library folder for books...');
						await this.plugin.library.scanLibraryFolder();
					});
			});
		}
		
		// Reading Experience Settings
		containerEl.createEl('h3', {text: 'Reading Experience'});
		
		new Setting(containerEl)
			.setName('Font Size')
			.setDesc('Adjust the text size for reading')
			.addSlider(slider => slider
				.setLimits(10, 24, 1)
				.setValue(this.plugin.settings.reading.fontSize)
				.setDynamicTooltip()
				.onChange(async (value) => {
					this.plugin.settings.reading.fontSize = value;
					await this.plugin.saveSettings();
				}));
				
		new Setting(containerEl)
			.setName('Line Height')
			.setDesc('Adjust the spacing between lines of text')
			.addSlider(slider => slider
				.setLimits(1.0, 2.0, 0.1)
				.setValue(this.plugin.settings.reading.lineHeight)
				.setDynamicTooltip()
				.onChange(async (value) => {
					this.plugin.settings.reading.lineHeight = value;
					await this.plugin.saveSettings();
				}));

				new Setting(containerEl)
			.setName('Theme')
			.setDesc('Choose the reading theme')
			.addDropdown(dropdown => dropdown
				.addOption('light', 'Light')
				.addOption('dark', 'Dark')
				.addOption('sepia', 'Sepia')
				.setValue(this.plugin.settings.reading.theme)
				.onChange(async (value: 'light' | 'dark' | 'sepia') => {
					this.plugin.settings.reading.theme = value;
					await this.plugin.saveSettings();
				}));
				
		new Setting(containerEl)
			.setName('Font Family')
			.setDesc('Choose the font used for reading')
			.addDropdown(dropdown => dropdown
				.addOption('system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif', 'System Default')
				.addOption('"Times New Roman", Times, serif', 'Serif')
				.addOption('Georgia, serif', 'Georgia')
				.addOption('Arial, sans-serif', 'Arial')
				.addOption('"Courier New", Courier, monospace', 'Monospace')
				.setValue(this.plugin.settings.reading.fontFamily)
				.onChange(async (value) => {
					this.plugin.settings.reading.fontFamily = value;
					await this.plugin.saveSettings();
				}));
				
		new Setting(containerEl)
			.setName('Page Turn Animation')
			.setDesc('Enable or disable page turn animations')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.reading.pageTurnAnimation)
				.onChange(async (value) => {
					this.plugin.settings.reading.pageTurnAnimation = value;
					await this.plugin.saveSettings();
				}));
				
		// Cloud Service Settings
		containerEl.createEl('h3', {text: 'Cloud Services'});
		
		new Setting(containerEl)
			.setName('Dropbox Integration')
			.setDesc('Connect to your Dropbox account to sync e-books')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.cloudServices.dropbox.enabled)
				.onChange(async (value) => {
					this.plugin.settings.cloudServices.dropbox.enabled = value;
					await this.plugin.saveSettings();
				}));
				
		new Setting(containerEl)
			.setName('Dropbox API Key')
			.setDesc('Enter your Dropbox API key')
			.addText(text => text
				.setPlaceholder('Enter API key')
				.setValue(this.plugin.settings.cloudServices.dropbox.apiKey)
				.onChange(async (value) => {
					this.plugin.settings.cloudServices.dropbox.apiKey = value;
					await this.plugin.saveSettings();
				}));
				
		new Setting(containerEl)
			.setName('Google Drive Integration')
			.setDesc('Connect to your Google Drive account to sync e-books')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.cloudServices.googleDrive.enabled)
				.onChange(async (value) => {
					this.plugin.settings.cloudServices.googleDrive.enabled = value;
					await this.plugin.saveSettings();
				}));
				
		new Setting(containerEl)
			.setName('Google Drive Client ID')
			.setDesc('Enter your Google Drive Client ID')
			.addText(text => text
				.setPlaceholder('Enter Client ID')
				.setValue(this.plugin.settings.cloudServices.googleDrive.clientId)
				.onChange(async (value) => {
					this.plugin.settings.cloudServices.googleDrive.clientId = value;
					await this.plugin.saveSettings();
				}));
				
		// Sync Settings
		containerEl.createEl('h3', {text: 'Synchronization'});
		
		new Setting(containerEl)
			.setName('Enable Sync')
			.setDesc('Synchronize your reading progress and annotations across devices')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.sync.enabled)
				.onChange(async (value) => {
					this.plugin.settings.sync.enabled = value;
					await this.plugin.saveSettings();
				}));
				
		new Setting(containerEl)
			.setName('Sync Bookmarks')
			.setDesc('Synchronize your bookmarks')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.sync.syncBookmarks)
				.onChange(async (value) => {
					this.plugin.settings.sync.syncBookmarks = value;
					await this.plugin.saveSettings();
				}));
				
		new Setting(containerEl)
			.setName('Sync Highlights')
			.setDesc('Synchronize your text highlights')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.sync.syncHighlights)
				.onChange(async (value) => {
					this.plugin.settings.sync.syncHighlights = value;
					await this.plugin.saveSettings();
				}));
				
		new Setting(containerEl)
			.setName('Sync Reading Progress')
			.setDesc('Synchronize your reading position')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.sync.syncReadingProgress)
				.onChange(async (value) => {
					this.plugin.settings.sync.syncReadingProgress = value;
					await this.plugin.saveSettings();
				}));
				
		new Setting(containerEl)
			.setName('Sync Notes')
			.setDesc('Synchronize your notes and annotations')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.sync.syncNotes)
				.onChange(async (value) => {
					this.plugin.settings.sync.syncNotes = value;
					await this.plugin.saveSettings();
				}));
	}
}