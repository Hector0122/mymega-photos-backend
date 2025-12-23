export declare class AppService {
    private s3;
    getPhotos(): Promise<string[]>;
    getPhotoByFilename(): Promise<void>;
}
