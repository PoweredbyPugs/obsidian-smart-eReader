/**
 * Parse an XML string into a DOM Document
 */
export function parseXml(xmlString: string): Document {
    const parser = new DOMParser();
    return parser.parseFromString(xmlString, 'application/xml');
}

/**
 * Generate a unique ID
 */
export function generateUniqueId(prefix: string = ''): string {
    return `${prefix}${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Format a date for display
 */
export function formatDate(timestamp: number): string {
    return new Date(timestamp).toLocaleDateString();
}

/**
 * Sanitize HTML content for safe display
 */
export function sanitizeHtml(html: string): string {
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = html;
    
    // Remove potentially dangerous elements and attributes
    const scripts = tempDiv.querySelectorAll('script');
    scripts.forEach(script => script.remove());
    
    const links = tempDiv.querySelectorAll('a');
    links.forEach(link => {
        // Remove javascript: URLs
        const href = link.getAttribute('href');
        if (href && href.toLowerCase().startsWith('javascript:')) {
            link.setAttribute('href', '#');
        }
    });
    
    // Remove on* attributes
    const allElements = tempDiv.querySelectorAll('*');
    allElements.forEach(el => {
        Array.from(el.attributes).forEach(attr => {
            if (attr.name.toLowerCase().startsWith('on')) {
                el.removeAttribute(attr.name);
            }
        });
    });
    
    return tempDiv.innerHTML;
}

/**
 * Truncate a string to a maximum length
 */
export function truncateString(str: string, maxLength: number): string {
    if (str.length <= maxLength) return str;
    return str.substring(0, maxLength - 3) + '...';
}

/**
 * Compare two version strings
 * Returns:
 * -1 if version1 < version2
 *  0 if version1 = version2
 *  1 if version1 > version2
 */
export function compareVersions(version1: string, version2: string): number {
    const parts1 = version1.split('.').map(Number);
    const parts2 = version2.split('.').map(Number);
    
    const maxLength = Math.max(parts1.length, parts2.length);
    
    for (let i = 0; i < maxLength; i++) {
        const part1 = i < parts1.length ? parts1[i] : 0;
        const part2 = i < parts2.length ? parts2[i] : 0;
        
        if (part1 < part2) return -1;
        if (part1 > part2) return 1;
    }
    
    return 0;
}

/**
 * Get file extension from a path
 */
export function getFileExtension(path: string): string {
    return path.split('.').pop()?.toLowerCase() || '';
}

/**
 * Format file size for display
 */
export function formatFileSize(bytes: number): string {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    return (bytes / (1024 * 1024 * 1024)).toFixed(1) + ' GB';
}