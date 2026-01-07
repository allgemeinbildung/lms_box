export const parseSimpleMarkdown = (text) => {
    return text ? text.replace(/\*\*(.*?)\*\*/g, '<b>$1</b>') : '';
};
