function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character] || character);
}

export function plainTextToHtml(value: string): string {
  return value.split(/\r\n|\r|\n/).map(line => line ? `<div>${escapeHtml(line)}</div>` : '<div><br></div>').join('');
}
