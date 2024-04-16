import express, { Response, Request } from "npm:express@latest";
import fileupload from "npm:express-fileupload@latest";
import * as bsmap from 'https://raw.githubusercontent.com/KivalEvan/BeatSaber-Deno/main/mod.ts';
import { compress, decompress } from "https://deno.land/x/zip@v1.2.5/mod.ts";
import fromV3Lightshow from "./functions/convertV3.ts";
import { IndexFilter } from "https://raw.githubusercontent.com/KivalEvan/BeatSaber-Deno/main/beatmap/v3/indexFilter.ts";
import { parse } from "https://deno.land/std@0.217.0/path/parse.ts";

const app = express();
app.use(fileupload());

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
    const info = await bsmap.load.info(4, { filePath: "map/Info.dat" })
    for (const diff of info.difficulties) {
        const v4Diff = bsmap.load.difficultySync(`map/${diff.filename}`);
        const v4Lightshow = bsmap.load.lightshowSync(`map/${diff.lightshowFilename}`);
        const v3Diff = bsmap.convert.toV3Difficulty(v4Diff);
        const v3Lightshow = bsmap.convert.toV3Lightshow(v4Lightshow);

        const newDiff = fromV3Lightshow(v3Diff, v3Lightshow);

        Deno.writeTextFile(`converted/${diff.difficulty}${diff.characteristic}.dat`, JSON.stringify(newDiff));
    }
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

    if (!converted) return res.send("failure")
    await compress("converted", "convertedDifficulties")
    res.download("convertedDifficulties.zip");
    setTimeout(() => {
        Deno.removeSync("map", { recursive: true });
        Deno.mkdirSync("map");
        Deno.removeSync("converted", { recursive: true });
        Deno.mkdirSync("converted");
        Deno.removeSync("map.zip");
        Deno.removeSync("convertedDifficulties.zip");
    }, 5000)
});

const port = Deno.env.get("PORT") || 3000

app.listen(port, () => console.log(`Listening on port ${port}`));