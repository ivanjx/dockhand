/**
 * Syntax-highlight a Dockerfile/shell command for display via {@html}.
 *
 * The input (e.g. an image layer's CreatedBy) is attacker-controlled in a
 * crafted image, so it MUST be HTML-escaped before any markup is inserted —
 * otherwise the {@html} render is an XSS sink.
 */
export function highlightCommand(cmd: string): string {
	if (!cmd) return '';

	// Dockerfile instructions
	const dockerInstructions = ['ADD', 'COPY', 'ENV', 'ARG', 'WORKDIR', 'RUN', 'CMD', 'ENTRYPOINT', 'EXPOSE', 'VOLUME', 'USER', 'LABEL', 'HEALTHCHECK', 'SHELL', 'ONBUILD', 'STOPSIGNAL', 'MAINTAINER', 'FROM'];
	const dockerInstructionPattern = new RegExp(`\\b(${dockerInstructions.join('|')})\\b`, 'g');

	// Shell keywords
	const shellKeywords = ['if', 'then', 'else', 'elif', 'fi', 'for', 'while', 'do', 'done', 'case', 'esac', 'function', 'in', 'select'];
	const shellKeywordPattern = new RegExp(`\\b(${shellKeywords.join('|')})\\b`, 'g');

	// Common commands
	const commands = ['apt-get', 'apk', 'yum', 'pip', 'npm', 'yarn', 'git', 'curl', 'wget', 'mkdir', 'cd', 'cp', 'mv', 'rm', 'chmod', 'chown', 'echo', 'cat', 'grep', 'sed', 'awk', 'tar', 'unzip', 'make', 'gcc', 'python', 'node', 'sh', 'bash'];
	const commandPattern = new RegExp(`\\b(${commands.join('|')})\\b`, 'g');

	// Escape HTML before inserting any markup. The input is attacker-controlled
	// (image build history) and rendered via {@html}, so unescaped < > & would be
	// an XSS sink.
	const highlighted = cmd
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		// Strings in quotes
		.replace(/("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/g, '<span class="text-green-600 dark:text-green-400">$1</span>')
		// Comments
		.replace(/(#[^\n]*)/g, '<span class="text-gray-500 dark:text-gray-400 italic">$1</span>')
		// Dockerfile instructions (must be before shell keywords to take precedence)
		.replace(dockerInstructionPattern, '<span class="text-blue-600 dark:text-blue-400 font-semibold">$1</span>')
		// Shell keywords
		.replace(shellKeywordPattern, '<span class="text-purple-600 dark:text-purple-400">$1</span>')
		// Commands
		.replace(commandPattern, '<span class="text-cyan-600 dark:text-cyan-400">$1</span>')
		// Flags (words starting with - or --)
		.replace(/(\s)(--?[a-zA-Z0-9-]+)/g, '$1<span class="text-yellow-600 dark:text-yellow-400">$2</span>');

	return highlighted;
}
