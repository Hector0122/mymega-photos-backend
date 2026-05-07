import { AppService } from './app.service';
export declare class AppController {
    private readonly appService;
    constructor(appService: AppService);
    getPhotos(): Promise<string[]>;
    getPhotoByFilename(): Promise<void>;
    uploadPhoto(body: {
        image: string;
        filename: string;
    }): Promise<{
        url: string;
    }>;
}
