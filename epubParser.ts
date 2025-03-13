import * as JSZip from 'jszip';
import { parseXml } from './utils';

export interface EpubMetadata {
    title?: string;
    creator?: string;
    publisher?: string;
    language?: string;
    identifier?: string;
    description?: string;
    published?: string;
    modified?: string;
    rights?: string;
}

export interface EpubNavPoint {
    id: string;
    label: string;
    href: string;
    order: number;
    children: EpubNavPoint[];
}

export interface EpubSpine {
    items: string[];
    toc: string;
}

export interface EpubManifestItem {
    id: string;
    href: string;
    mediaType: string;
}

export interface EpubContent {
    metadata: EpubMetadata;
    spine: EpubSpine;
    manifest: Record<string, EpubManifestItem>;
    navPoints: EpubNavPoint[];
    coverPath?: string;
    coverData?: Uint8Array;
    content: Record<string, string>;
    resources: Record<string, Uint8Array>; // Store all binary resources
    basePath: string; // Store the OPF directory for resolving relative paths
}

/**
 * Parse an EPUB file and extract its contents
 */
export async function parseEpub(data: ArrayBuffer): Promise<EpubContent> {
    // Load the epub file with JSZip
    const zip = await JSZip.loadAsync(data);
    
    // Find and parse the container.xml to get the rootfile
    const containerXml = await zip.file('META-INF/container.xml')?.async('string');
    if (!containerXml) {
        throw new Error('Invalid EPUB: Missing container.xml');
    }
    
    const containerDoc = parseXml(containerXml);
    const rootfilePath = containerDoc.querySelector('rootfile')?.getAttribute('full-path');
    if (!rootfilePath) {
        throw new Error('Invalid EPUB: Unable to find rootfile path');
    }
    
    // Parse the rootfile (OPF file)
    const opfContent = await zip.file(rootfilePath)?.async('string');
    if (!opfContent) {
        throw new Error(`Invalid EPUB: Missing OPF file at ${rootfilePath}`);
    }
    
    const opfDoc = parseXml(opfContent);
    
    // Get the directory path of the OPF file to resolve relative paths
    const basePath = rootfilePath.substring(0, rootfilePath.lastIndexOf('/') + 1);
    
    // Parse metadata
    const metadata = parseMetadata(opfDoc);
    
    // Parse manifest items
    const manifest = parseManifest(opfDoc, basePath);
    
    // Parse spine (reading order)
    const spine = parseSpine(opfDoc);
    
    // Find and parse the TOC (NCX file)
    const tocHref = manifest[spine.toc]?.href;
    let navPoints: EpubNavPoint[] = [];
    
    if (tocHref) {
        const tocContent = await zip.file(tocHref)?.async('string');
        if (tocContent) {
            navPoints = parseNavPoints(parseXml(tocContent));
        }
    }
    
    // Find cover image
    const coverPath = findCoverPath(opfDoc, manifest);
    let coverData: Uint8Array | undefined;
    
    if (coverPath) {
        coverData = await zip.file(coverPath)?.async('uint8array');
    }
    
    // Load all HTML content and resources
    const content: Record<string, string> = {};
    const resources: Record<string, Uint8Array> = {};
    
    // First, load all resources
    for (const item of Object.values(manifest)) {
        // Extract images and other binary files
        if (item.mediaType.startsWith('image/')) {
            try {
                const resource = await zip.file(item.href)?.async('uint8array');
                if (resource) {
                    resources[item.href] = resource;
                    // Also store with the file name as key for easier lookup
                    const fileName = item.href.split('/').pop() || '';
                    if (fileName) {
                        resources[fileName] = resource;
                    }
                }
            } catch (e) {
                console.error(`Error extracting resource ${item.href}:`, e);
            }
        }
    }
    
    // Then load HTML content
    for (const item of Object.values(manifest)) {
        if (item.mediaType === 'application/xhtml+xml' || 
            item.mediaType === 'text/html') {
            try {
                const htmlContent = await zip.file(item.href)?.async('string');
                if (htmlContent) {
                    // Process HTML to handle relative paths
                    content[item.id] = processHtml(htmlContent, item.href, basePath, manifest);
                }
            } catch (e) {
                console.error(`Error extracting HTML content ${item.href}:`, e);
                content[item.id] = `<p>Error loading content: ${e.message}</p>`;
            }
        }
    }
    
    return {
        metadata,
        spine,
        manifest,
        navPoints,
        coverPath,
        coverData,
        content,
        resources,
        basePath
    };
}

/**
 * Process HTML content to handle relative paths
 */
function processHtml(html: string, htmlPath: string, basePath: string, manifest: Record<string, EpubManifestItem>): string {
    const htmlDir = htmlPath.substring(0, htmlPath.lastIndexOf('/') + 1);
    
    // Parse the HTML
    const doc = parseXml(html);
    
    // Process image sources
    const images = doc.querySelectorAll('img');
    Array.from(images).forEach(img => {
        const src = img.getAttribute('src');
        if (src && !src.startsWith('http')) {
            // Handle relative paths
            // Store the original src as a data attribute
            img.setAttribute('data-original-src', src);
            
            // Add a special class for the reader to identify EPUB images
            img.classList.add('epub-image');
        }
    });
    
    // Process CSS links
    const links = doc.querySelectorAll('link[rel="stylesheet"]');
    Array.from(links).forEach(link => {
        const href = link.getAttribute('href');
        if (href && !href.startsWith('http')) {
            // Handle relative paths
            link.setAttribute('data-original-href', href);
        }
    });
    
    // Convert back to string
    const serializer = new XMLSerializer();
    return serializer.serializeToString(doc);
}

/**
 * Parse the metadata section of the OPF file
 */
function parseMetadata(opfDoc: Document): EpubMetadata {
    const metadataEl = opfDoc.querySelector('metadata');
    if (!metadataEl) return {};
    
    const metadata: EpubMetadata = {};
    
    // Dublin Core elements
    const dcElements = ['title', 'creator', 'publisher', 'language', 'identifier', 'description', 'rights'];
    for (const el of dcElements) {
        const element = metadataEl.querySelector(`dc\\:${el}, *|${el}`);
        if (element?.textContent) {
            metadata[el as keyof EpubMetadata] = element.textContent;
        }
    }
    
    // Publication date
    const pubDate = metadataEl.querySelector('dc\\:date, *|date');
    if (pubDate?.textContent) {
        metadata.published = pubDate.textContent;
    }
    
    // Modified date
    const modifiedEl = metadataEl.querySelector('meta[property="dcterms:modified"]');
    if (modifiedEl?.textContent) {
        metadata.modified = modifiedEl.textContent;
    }
    
    return metadata;
}

/**
 * Parse the manifest section of the OPF file
 */
function parseManifest(opfDoc: Document, basePath: string): Record<string, EpubManifestItem> {
    const manifestItems: Record<string, EpubManifestItem> = {};
    const items = opfDoc.querySelectorAll('manifest item');
    
    // Convert NodeList to Array before iterating
    Array.from(items).forEach(item => {
        const id = item.getAttribute('id');
        const href = item.getAttribute('href');
        const mediaType = item.getAttribute('media-type');
        
        if (id && href && mediaType) {
            // Resolve the path relative to the OPF file
            const fullHref = resolveRelativePath(href, basePath);
            
            manifestItems[id] = {
                id,
                href: fullHref,
                mediaType
            };
        }
    });
    
    return manifestItems;
}

/**
 * Resolve a relative path against a base path
 */
function resolveRelativePath(relativePath: string, basePath: string): string {
    // Handle absolute paths
    if (relativePath.startsWith('/')) {
        return relativePath.substring(1); // Remove leading slash
    }
    
    // Handle relative paths
    if (!basePath) return relativePath;
    
    const parts = relativePath.split('/');
    const basePathParts = basePath.split('/').filter(p => p.length > 0);
    
    // Remove the file part of the base path
    if (basePathParts.length > 0) {
        basePathParts.pop();
    }
    
    // Process each part
    for (const part of parts) {
        if (part === '..') {
            // Go up one directory
            if (basePathParts.length > 0) {
                basePathParts.pop();
            }
        } else if (part !== '.' && part.length > 0) {
            // Add part to path
            basePathParts.push(part);
        }
    }
    
    return basePathParts.join('/');
}

/**
 * Parse the spine section of the OPF file
 */
function parseSpine(opfDoc: Document): EpubSpine {
    const spineEl = opfDoc.querySelector('spine');
    const items: string[] = [];
    let toc = '';
    
    if (spineEl) {
        // Get the TOC attribute
        toc = spineEl.getAttribute('toc') || '';
        
        // Get all itemref elements and their idref attributes
        const itemRefs = spineEl.querySelectorAll('itemref');
        // Convert NodeList to Array before iterating
        Array.from(itemRefs).forEach(item => {
            const idref = item.getAttribute('idref');
            if (idref) {
                items.push(idref);
            }
        });
    }
    
    return { items, toc };
}

/**
 * Parse the navigation points from the NCX file
 */
function parseNavPoints(ncxDoc: Document): EpubNavPoint[] {
    const navPoints: EpubNavPoint[] = [];
    const navMap = ncxDoc.querySelector('navMap');
    
    if (navMap) {
        const navPointElements = navMap.querySelectorAll('navPoint');
        // Convert NodeList to Array before iterating
        Array.from(navPointElements).forEach(el => {
            const navPoint = parseNavPoint(el);
            if (navPoint) {
                navPoints.push(navPoint);
            }
        });
    }
    
    return navPoints.sort((a, b) => a.order - b.order);
}

/**
 * Parse a single navigation point from the NCX file
 */
function parseNavPoint(element: Element): EpubNavPoint | null {
    const id = element.getAttribute('id');
    const playOrder = element.getAttribute('playOrder');
    const labelEl = element.querySelector('navLabel text');
    const contentEl = element.querySelector('content');
    
    if (!id || !labelEl?.textContent || !contentEl) {
        return null;
    }
    
    const label = labelEl.textContent;
    const href = contentEl.getAttribute('src') || '';
    const order = playOrder ? parseInt(playOrder, 10) : 0;
    
    // Parse child nav points
    const children: EpubNavPoint[] = [];
    const childElements = element.querySelectorAll(':scope > navPoint');
    // Convert NodeList to Array before iterating
    Array.from(childElements).forEach(el => {
        const childNavPoint = parseNavPoint(el);
        if (childNavPoint) {
            children.push(childNavPoint);
        }
    });
    
    return {
        id,
        label,
        href,
        order,
        children
    };
}

/**
 * Find the cover image path
 */
function findCoverPath(opfDoc: Document, manifest: Record<string, EpubManifestItem>): string | undefined {
    // Strategy 1: Look for a meta element with name="cover"
    const coverMeta = opfDoc.querySelector('meta[name="cover"]');
    if (coverMeta) {
        const coverId = coverMeta.getAttribute('content');
        if (coverId && manifest[coverId]) {
            return manifest[coverId].href;
        }
    }
    
    // Strategy 2: Look for an item with id="cover" or id="cover-image"
    const coverIds = ['cover', 'cover-image'];
    for (const id of coverIds) {
        if (manifest[id] && isImageType(manifest[id].mediaType)) {
            return manifest[id].href;
        }
    }
    
    // Strategy 3: Look for an item with properties="cover-image"
    const items = opfDoc.querySelectorAll('manifest item[properties="cover-image"]');
    for (const item of Array.from(items)) {
        const id = item.getAttribute('id');
        if (id && manifest[id]) {
            return manifest[id].href;
        }
    }
    
    // Strategy 4: Just look for any image with "cover" in the ID or href
    for (const item of Object.values(manifest)) {
        if (isImageType(item.mediaType) && 
            (item.id.toLowerCase().includes('cover') || 
             item.href.toLowerCase().includes('cover'))) {
            return item.href;
        }
    }
    
    return undefined;
}

/**
 * Check if a media type is an image
 */
function isImageType(mediaType: string): boolean {
    return mediaType.startsWith('image/');
}