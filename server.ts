import express, { Response, Request } from "npm:express@latest";
import fileupload from "npm:express-fileupload@latest";
import * as bsmap from 'https://raw.githubusercontent.com/KivalEvan/BeatSaber-Deno/main/mod.ts';
import { compress, decompress } from "https://deno.land/x/zip@v1.2.5/mod.ts";
import fromV3Lightshow from "./functions/convertV3.ts";
import { AudioData } from "https://raw.githubusercontent.com/KivalEvan/BeatSaber-Deno/main/beatmap/v4/audioData.ts";

const app = express();
app.use(fileupload());

function removeEmpty(o: any) {
    for (let key in o) {
        if (!o[key] || typeof o[key] !== "object") {
            continue;
        }

        removeEmpty(o[key]);
        if (Object.keys(o[key]).length === 0 && key !== "rotationEvents" && key !== "waypoints" && key !== "vfxEventBoxGroups" && key !== "_fxEventsCollection" && key !== "basicEventTypesWithKeywords" && key !== "e") {
            delete o[key];
        }
    }
    return o;
}

async function exists(filename: string): Promise<boolean | any> {
    try {
        await Deno.stat(filename)

        return true;
    } catch (err) {
        if (err instanceof Deno.errors.NotFound) {
            return false;
        } else {
            return err;
        }
    }
}

async function ConvertV4(): Promise<boolean> {
    const existFile = await exists("map/Info.dat")
    if (!existFile) return false;
    const info = await bsmap.load.info(4, { filePath: "map/Info.dat" });
    let audioData: AudioData;
    if (info.audio.audioDataFilename) {
        audioData = bsmap.load.audioDataSync(`map/${info.audio.audioDataFilename}`, 4);
        const BPMInfo = {
            _version: "2.0.0",
            _songSampleCount: audioData.sampleCount,
            _songFrequency: audioData.frequency,
            _regions: audioData.bpmData.map(d => {
                return {
                    _startSampleIndex: d.startSampleIndex,
                    _endSampleIndex: d.endSampleIndex,
                    _startBeat: d.startBeat,
                    _endBeat: d.endBeat
                }
            })
        };
        Deno.writeTextFileSync(`converted/BPMInfo.dat`, JSON.stringify(BPMInfo));
    }
    for (const diff of info.difficulties) {
        const v4Diff = bsmap.load.difficultySync(`map/${diff.filename}`);
        const v4Lightshow = bsmap.load.lightshowSync(`map/${diff.lightshowFilename}`);
        const v3Diff = bsmap.convert.toV3Difficulty(v4Diff);
        const v3Lightshow = bsmap.convert.toV3Lightshow(v4Lightshow);

        const newDiff = fromV3Lightshow(v3Diff, v3Lightshow);

        // @ts-ignore
        if (audioData) {
            const bpmEvents = bsmap.load.audioDataSync(`converted/BPMInfo.dat`).getBpmEvents();
            bpmEvents.forEach(e => {
                newDiff.addBpmEvents(e);
            })
        }

        const copy: any = JSON.parse(JSON.stringify(newDiff));

        if (diff.characteristic === "Standard") {
            Deno.writeTextFileSync(`converted/${diff.difficulty}.beatmap.dat`, JSON.stringify(removeEmpty(copy)));
        } else {
            Deno.writeTextFileSync(`converted/${diff.characteristic}${diff.difficulty}.beatmap.dat`, JSON.stringify(removeEmpty(copy)));
        }
    }
    const convertedInfo = bsmap.convert.toV2Info(info);
    Deno.writeTextFileSync(`converted/Info.dat`, JSON.stringify(convertedInfo));
    Deno.writeFileSync(`converted/${info.audio.filename}`, Deno.readFileSync(`map/${info.audio.filename}`));
    info.coverImageFilename != "" ? Deno.writeFileSync(`converted/${info.coverImageFilename}`, Deno.readFileSync(`map/${info.coverImageFilename}`)) : null;
    return true;
}

app.get("/", (_req: Request, res: Response) => {
    const page = Deno.readTextFileSync("index.html")
    res.send(page)
});

app.post("/convert", async (req: Request, res: Response) => {
    const data = req.files.fileUploaded.data
    Deno.writeFileSync("map.zip", new Uint8Array(data))

    await decompress("map.zip", "map");

    const converted = await ConvertV4();

    if (!converted) return res.send("Failure.\nZip structure incorrect.")
    await compress("converted", "convertedMap")
    res.download("convertedMap.zip");
    setTimeout(() => {
        Deno.removeSync("map", { recursive: true });
        Deno.mkdirSync("map");
        Deno.removeSync("converted", { recursive: true });
        Deno.mkdirSync("converted");
        Deno.removeSync("map.zip");
        Deno.removeSync("convertedMap.zip");
    }, 2000)
});

const port = Deno.env.get("PORT") || 3000

app.listen(port, () => console.log(`Listening on port ${port}`));