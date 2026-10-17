
const names = ['read', 'bash', 'write', 'search_knowledge', 'reader_read_chapter',
  'generate_image', 'generate_video', 'report_studio', 'read_image', 'web_search',
  'mnemo_recall', 'mnemo_store', 'search_experience', 'read_knowledge_fragment'];
export const catalog = names.map(name => ({
  name,
  description: `Synthetic capability ${name} used only for offline policy tests.`,
  parameters: {type: 'object', properties: {}, additionalProperties: true},
}));
