export const parseSimpleMarkdown = (text) => {
    if (!text) return '';
    return text
        .replace(/\*\*(.*?)\*\*/g, '<b>$1</b>')
        .replace(/\*(.*?)\*/g, '<i>$1</i>');
};

export const normalizeAnswer = (raw) => {
    if (!raw) return '';
    return String(raw)
        .replace(/<[^>]*>/g, ' ')
        .replace(/&nbsp;/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
};

/**
 * Compare current student answers against stored feedback results.
 * Returns { hasChanges: boolean, changedQuestionIds: Set<string> }
 */
export const detectUpdatedAnswers = (assignmentData, feedbackData) => {
    const changedQuestionIds = new Set();
    if (!assignmentData || !feedbackData) return { hasChanges: false, changedQuestionIds };

    let currentResults = feedbackData.results;
    if (feedbackData.history && Array.isArray(feedbackData.history) && feedbackData.history.length > 0) {
        currentResults = feedbackData.history[feedbackData.history.length - 1].results;
    }
    if (!Array.isArray(currentResults)) return { hasChanges: false, changedQuestionIds };

    // Build map: "subId_questionId" -> current answer text
    const currentAnswerMap = new Map();
    Object.entries(assignmentData).forEach(([subId, subTask]) => {
        if (subTask.answers) {
            subTask.answers.forEach(a => {
                currentAnswerMap.set(`${subId}_${a.questionId}`, a.answer || '');
            });
        }
    });

    // Compare each feedback result's original_answer with current answer
    currentResults.forEach(item => {
        const qid = item.question_id;
        const feedbackAnswer = normalizeAnswer(
            item.original_answer || item.originalAnswer || item.student_answer ||
            item.studentAnswer || item.student_response || item.studentResponse || item.answer || ''
        );
        const currentAnswer = normalizeAnswer(currentAnswerMap.get(qid) || '');
        if (feedbackAnswer !== currentAnswer) {
            changedQuestionIds.add(qid);
        }
    });

    // Also flag new answers for questions that had no feedback result
    const feedbackQids = new Set(currentResults.map(r => r.question_id));
    currentAnswerMap.forEach((answer, qid) => {
        if (!feedbackQids.has(qid) && normalizeAnswer(answer)) {
            changedQuestionIds.add(qid);
        }
    });

    return { hasChanges: changedQuestionIds.size > 0, changedQuestionIds };
};
