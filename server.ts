import multer from "multer";
import AdmZip from "adm-zip";
import express, { json, Request } from "express";
import path from "path";
import { Info, loadInfo, readAudioDataFileSync, saveInfo, readDifficultyFileSync, readLightshowFileSync, writeDifficultyFileSync, writeAudioDataFile } from "bsmap";
import fs from "fs";

function removeEmpty(o: any) {
    for (let key in o) {
        if (!o[key] || typeof o[key] !== "object") {
            continue;
        }

        removeEmpty(o[key]);
        if (Object.keys(o[key]).length === 0 && key === "customData") {
            delete o[key];
        }
    }
    return o;
}

function changeInfo(info: Info) {
    info.difficulties.forEach(diff => {
        diff.colorSchemeId = 0;
    });
}

function exists(filename: string, returnPath: boolean = false): boolean | any {
    try {
        const stats = fs.statSync(filename);
        if (stats.isDirectory()) {
            throw new Error(`Expected a file but found a directory: ${filename}`);
        }

        if (returnPath) {
            return path.join(filename);
        }

        const data = fs.readFileSync(filename, 'utf-8');
        return JSON.parse(data);
    } catch (err) {
        console.error(`Error in exists function for file ${filename}:`, err);
        return false;
    }
}


async function ConvertV4(): Promise<boolean> {
    try {
        const infoFile = exists(path.join("map", "Info.dat"));
        if (!infoFile) return false;
        const info = loadInfo(infoFile, 4) as Info;
        changeInfo(info);

        const audioFile = exists(path.join("map", info.audio.audioDataFilename), true)
        const audioData = readAudioDataFileSync(audioFile).setFilename(
            'BPMInfo.dat',
        );
        writeAudioDataFile(audioData, 2);

        const bpmEvents = audioData.getBpmEvents();

        fs.writeFileSync(`converted/BPMInfo.dat`, JSON.stringify(audioData));

        for (const diff of info.difficulties) {
            const v4DiffFile = exists(path.join("map", diff.filename), true);
            const v4Diff = readDifficultyFileSync(v4DiffFile);
            const v4LightshowFile = exists(path.join("map", diff.lightshowFilename), true);
            const v4Lightshow = readLightshowFileSync(v4LightshowFile);
            v4Diff.lightshow = v4Lightshow.lightshow;

            if (audioData) {
                v4Diff.bpmEvents = [];
                v4Diff.addBpmEvents(...bpmEvents);
            }

            const newDiff = writeDifficultyFileSync(v4Diff, 3);

            const copy: any = JSON.parse(JSON.stringify(newDiff));

            if (diff.characteristic === "Standard") {
                fs.writeFileSync(`converted/${diff.difficulty}.beatmap.dat`, JSON.stringify(removeEmpty(copy)));
            } else {
                fs.writeFileSync(`converted/${diff.characteristic}${diff.difficulty}.beatmap.dat`, JSON.stringify(removeEmpty(copy)));
            }
        }

        const convertedInfo = saveInfo(info, 2);
        const infoCopy = JSON.parse(JSON.stringify(convertedInfo));
        fs.writeFileSync(`converted/Info.dat`, JSON.stringify(infoCopy));
        fs.writeFileSync(`converted/${info.audio.filename}`, fs.readFileSync(`map/${info.audio.filename}`));
        info.coverImageFilename != "" ? fs.writeFileSync(`converted/${info.coverImageFilename}`, fs.readFileSync(`map/${info.coverImageFilename}`)) : null;
        return true;
    } catch (e) {
        console.log(e)
        return false;
    }
}

const storage = multer.diskStorage({
    destination: (req, res, cb) => {
        cb(null, "./processed/");
    },
    filename: (req, file, cb) => {
        cb(null, file.originalname);
    }
});

const upload = multer({ storage: storage, limits: { fieldSize: 20 * 1024 * 1024 } });

export const uploadMiddleware = upload.fields([
    { name: "map", maxCount: 1 },
]);

interface MulterFile {
    map?: Express.Multer.File[];
}

// @ts-ignore
interface TypedRequest extends Request {
    files?: MulterFile;
}

const app = express();

app.use(express.json());
app.use(express.urlencoded({ limit: "30mb", extended: true, parameterLimit: 10000 }));

app.get("/", (req, res) => {
    const html = String(fs.readFileSync(path.join(__dirname, "index.html")));
    res.send(html);
})

// @ts-ignore
app.post("/api/upload", uploadMiddleware, async (req: TypedRequest, res) => {
    const mapZip = req.files?.map ? (req.files?.map as Express.Multer.File[])[0] : undefined

    if (!mapZip) {
        return res.status(400).send("No map provided.");
    }

    fs.mkdirSync(path.join(__dirname, "map"), { recursive: true });
    fs.mkdirSync(path.join(__dirname, "converted"), { recursive: true });

    const convertedName = mapZip.filename.split(".")[0]

    const zipPath = path.join(mapZip.destination, mapZip.filename);

    const zip = new AdmZip(zipPath);
    zip.extractAllTo(path.join(__dirname, "map"));

    const converted = await ConvertV4();

    if (converted) {

        const newZip = new AdmZip();

        newZip.addLocalFolder(path.join(__dirname, "converted"))

        const buffer = newZip.toBuffer();

        res.set({
            'Content-Type': 'application/zip',
            'Content-Disposition': `attachment; filename="${convertedName}_converted.zip"`,
            'Content-Length': buffer.length
        });

        res.send(buffer);

        res.on('finish', () => {
            fs.unlinkSync(zipPath);
            fs.rmSync(path.join(__dirname, "map"), { recursive: true, force: true });
            fs.rmSync(path.join(__dirname, "converted"), { recursive: true, force: true });
        });
    } else {
        fs.unlinkSync(zipPath);
        fs.rmSync(path.join(__dirname, "map"), { recursive: true, force: true });
        fs.rmSync(path.join(__dirname, "converted"), { recursive: true, force: true });
        return res.status(500).send("Something went wrong.")
    }
});

app.listen(process.env.PORT || 3000, () => console.log("Listening on port", process.env.PORT || "3000"));