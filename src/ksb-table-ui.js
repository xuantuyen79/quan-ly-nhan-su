// Insert the standalone browser script as text, never serialize a bundled function.
export function withTableUI(html, script) {
  const at = html.lastIndexOf('</body>');
  if (at < 0) return html;
  return html.slice(0, at) + '<script>' + script + '</script>' + html.slice(at);
}
