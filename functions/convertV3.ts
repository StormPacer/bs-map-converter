import * as bsmap from 'https://raw.githubusercontent.com/KivalEvan/BeatSaber-Deno/main/mod.ts';

function fromV3Lightshow(template: bsmap.v3.Difficulty, data: bsmap.v3.Lightshow): bsmap.v3.Difficulty {
    template.addBasicEvents(...data.basicEvents);
    template.addColorBoostEvents(...data.colorBoostEvents);
    template.addLightColorEventBoxGroups(...data.lightColorEventBoxGroups);
    template.addLightRotationEventBoxGroups(...data.lightRotationEventBoxGroups);
    template.addLightTranslationEventBoxGroups(
        ...data.lightTranslationEventBoxGroups,
    );
    template.addFxEventBoxGroups(...data.fxEventBoxGroups);
    template.eventTypesWithKeywords = data.eventTypesWithKeywords.clone();
    template.customData = bsmap.deepCopy(data.customData);
    return template;
}

export default fromV3Lightshow;