/**
 * Intent Detector
 *
 * Determines if a prompt is a substantial task worth tracking.
 * Filters out commands, questions, short replies, and acknowledgments.
 */

/**
 * Detect if prompt is a substantial task (not a command, question, or short reply)
 */
export function isSubstantialTask(prompt: string): boolean {
  const trimmed = prompt.trim();

  // Too short
  if (trimmed.length < 25) return false;

  // Commands (slash commands)
  if (trimmed.startsWith('/')) return false;

  // Simple acknowledgments
  if (/^(ok|okay|yes|no|sure|thanks|thank you|got it|sounds good|go ahead|do it|perfect|great|nice|cool|awesome|yep|nope|fine|alright)/i.test(trimmed)) {
    return false;
  }

  // Questions without action intent
  if (/^(what|who|when|where|why|how|can you explain|could you tell|is there|are there|does|do you|will|would)/i.test(trimmed) &&
      !/\b(create|build|make|write|add|implement|fix|update|change|refactor|remove|delete)\b/i.test(trimmed)) {
    return false;
  }

  // Follow-ups and modifications
  if (/^(also|and |actually|wait|nevermind|ignore|cancel|stop|hold on|scratch that)/i.test(trimmed)) {
    return false;
  }

  // Single word or very short phrases
  if (trimmed.split(/\s+/).length < 4) return false;

  // Has task-like verbs
  const hasTaskVerb = /\b(create|build|make|write|implement|add|remove|delete|update|fix|refactor|change|modify|setup|configure|install|deploy|test|debug|migrate|convert|extract|generate|design|develop|integrate|optimize|improve|move|rename|copy|merge|split|combine|clean|format|organize|sort|validate|check|verify|review|analyze|investigate|find|search|look|show|display|print|log|trace|profile|benchmark|measure|document|explain|describe|outline|list|summarize|compare|diff|patch|apply|revert|undo|redo|restore|backup|export|import|upload|download|fetch|pull|push|sync|connect|disconnect|start|stop|restart|pause|resume|run|execute|compile|link|package|bundle|minify|compress|encrypt|decrypt|hash|sign|authenticate|authorize|login|logout|register|subscribe|unsubscribe|enable|disable|activate|deactivate|toggle|switch|set|get|put|post|send|receive|emit|listen|handle|process|parse|serialize|deserialize|encode|decode|transform|convert|map|filter|reduce|sort|group|aggregate|calculate|compute|evaluate|render|draw|paint|animate|transition|style|theme|layout|position|align|center|wrap|truncate|clip|mask|blend|overlay|layer|stack|nest|embed|inject|insert|append|prepend|replace|substitute|swap|exchange|transfer|copy|clone|duplicate|fork|branch|checkout|commit|push|pull|fetch|merge|rebase|squash|cherry-pick|stash|pop|drop|reset|clean|prune|gc|archive|tag|release|publish|deploy|rollback|scale|provision|configure|bootstrap|initialize|setup|teardown|destroy|terminate|kill|spawn|fork|exec|pipe|redirect|stream|buffer|cache|store|persist|save|load|read|write|open|close|lock|unlock|acquire|release|wait|notify|signal|interrupt|abort|cancel|timeout|retry|fallback|recover|heal|repair|maintain|monitor|watch|observe|track|trace|log|audit|report|alert|warn|error|throw|catch|handle|recover|ignore|suppress|silence|mute|unmute|show|hide|reveal|conceal|expose|protect|secure|sanitize|escape|unescape|quote|unquote|wrap|unwrap|box|unbox|pack|unpack|zip|unzip|tar|untar|gzip|gunzip|inflate|deflate)\b/i.test(trimmed);

  // Long enough with task verb = definitely a task
  if (hasTaskVerb && trimmed.length > 30) return true;

  // Very long prompts are likely tasks even without explicit verbs
  if (trimmed.length > 100) return true;

  return hasTaskVerb;
}
