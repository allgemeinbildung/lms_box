export const state = {
    draftsMap: {},
    currentTeacherKey: ''
};

export const setTeacherKey = (key) => {
    state.currentTeacherKey = key;
};

export const setDraftsMap = (map) => {
    state.draftsMap = map;
};
