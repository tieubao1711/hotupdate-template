const { ccclass, property } = cc._decorator;

const customManifestStr = (hots) => JSON.stringify({
    "packageUrl": `${hots}/`,
    "remoteManifestUrl": `${hots}/project.manifest`,
    "remoteVersionUrl": `${hots}/version.manifest`,
    "version": "0.0.0",
    "assets": {
    },
    "searchPaths": []
});

function versionCompareHandle(versionA: string, versionB: string) {
    // cc.log("JS Custom Version Compare: version A is " + versionA + ', version B is ' + versionB);
    var vA = versionA.split('.');
    var vB = versionB.split('.');
    for (var i = 0; i < vA.length; ++i) {
        var a = parseInt(vA[i]);
        var b = parseInt(vB[i] || '0');
        if (a === b) {
            continue;
        }
        else {
            return a - b;
        }
    }
    if (vB.length > vA.length) {
        return -1;
    }
    else {
        return 0;
    }
};

@ccclass
export default class LoadGameController extends cc.Component {

    @property(cc.Sprite)
    loadingSprite: cc.Sprite = null;

    @property(cc.Label)
    loadingLabel: cc.Label = null;

    private _updating = false;
    private _canRetry = false;
    private _storagePath = '';
    private stringHost = '';
    private _am: jsb.AssetsManager = null!;
    private _checkListener = null;
    private _updateListener = null;
    private count = 0;

    onLoad() {
        // Hot update is only available in Native build
        if (!jsb) {
            return;
        }
        this._storagePath = ((jsb.fileUtils ? jsb.fileUtils.getWritablePath() : '/') + 'remote-assets');
        // cc.log('Storage path for remote asset : ' + this._storagePath);
        // Init with empty manifest url for testing custom manifest
        this._am = new jsb.AssetsManager('', this._storagePath, versionCompareHandle);
        this._am.setVerifyCallback(function (path, asset) {
            // When asset is compressed, we don't need to check its md5, because zip file have been deleted.
            var compressed = asset.compressed;
            // Retrieve the correct md5 value.
            var expectedMD5 = asset.md5;
            // asset.path is relative path and path is absolute.
            var relativePath = asset.path;
            // The size of asset file, but this value could be absent.
            var size = asset.size;
            if (compressed) {
                cc.log("Verification passed : " + relativePath);
                return true;
            }
            else {
                cc.log("Verification passed : " + relativePath + ' (' + expectedMD5 + ')');
                return true;
            }
        });
    }

    onDestroy() {
        if (this._updateListener) {
            this._am.setEventCallback(null!);
            this._updateListener = null;
        }
    }

    async start() {
        this.schedule(() => {
            this.count += 0.01;
            this.updateProcess(this.count);
            if (this.count >= 1) {
                this.loadMyGame();
            }
        }, 0.03);
        if (cc.sys.isMobile) {
            this.onCheckGame('https://ios.b29apires.club/remote-assets/');
        }
    }

    loadMyGame() {
        this.unscheduleAllCallbacks();
        cc.director.loadScene('HomeScene');
    }

    onCheckGame(val) {
        // cc.log('checkGame', val);
        this.unscheduleAllCallbacks();
        this.stringHost = val;
        this.hotUpdate();
    }

    loadCustomManifest(host) {
        var manifest = new jsb.Manifest(customManifestStr(host), this._storagePath);
        this._am.loadLocalManifest(manifest, this._storagePath);
    }

    updateCb(event: any) {
        var needRestart = false;
        var failed = false;
        switch (event.getEventCode()) {
            case jsb.EventAssetsManager.ERROR_NO_LOCAL_MANIFEST:
                cc.log('No local manifest file found, hot update skipped.');
                failed = true;
                break;
            case jsb.EventAssetsManager.UPDATE_PROGRESSION:
                // this.panel.byteProgress.progress = event.getPercent();
                // this.panel.fileProgress.progress = event.getPercentByFile();

                const percent = event.getDownloadedFiles() / event.getTotalFiles();
                // this.panel.byteLabel.string = event.getDownloadedBytes() + ' / ' + event.getTotalBytes();
                var msg = event.getMessage();
                if (msg) {
                    // cc.log(event.getPercent()/100 + '% : ' + msg);
                }
                this.updateProcess(percent);
                break;
            case jsb.EventAssetsManager.ERROR_DOWNLOAD_MANIFEST:
            case jsb.EventAssetsManager.ERROR_PARSE_MANIFEST:
                cc.log('Fail to download manifest file, hot update skipped.');
                failed = true;
                break;
            case jsb.EventAssetsManager.ALREADY_UP_TO_DATE:
                cc.log('Already up to date with the latest remote version.');
                // failed = true;
                needRestart = true;
                break;
            case jsb.EventAssetsManager.UPDATE_FINISHED:
                cc.log('Update finished. ' + event.getMessage());
                needRestart = true;
                break;
            case jsb.EventAssetsManager.UPDATE_FAILED:
                cc.log('Update failed. ' + event.getMessage());
                this._updating = false;
                this._canRetry = true;
                failed = true;
                break;
            case jsb.EventAssetsManager.ERROR_UPDATING:
                cc.log('Asset update error: ' + event.getAssetId() + ', ' + event.getMessage());
                failed = true;
                break;
            case jsb.EventAssetsManager.ERROR_DECOMPRESS:
                cc.log(event.getMessage());
                failed = true;
                break;
            default:
                break;
        }

        if (failed) {
            this._am.setEventCallback(null!);
            this._updateListener = null;
            this._updating = false;
            this.loadMyGame();
        }
        if (needRestart) {
            this._am.setEventCallback(null!);
            this._updateListener = null;
            // Prepend the manifest's search path
            var searchPaths = jsb.fileUtils.getSearchPaths();
            var newPaths = this._am.getLocalManifest().getSearchPaths();
            // cc.log(JSON.stringify(newPaths));
            Array.prototype.unshift.apply(searchPaths, newPaths);
            // This value will be retrieved and appended to the default search path during game startup,
            // please refer to samples/js-tests/main.js for detailed usage.
            // !!! Re-add the search paths in main.js is very important, otherwise, new scripts won't take effect.
            cc.sys.localStorage.setItem('HotUpdateSearchPaths-game', JSON.stringify(searchPaths));
            jsb.fileUtils.setSearchPaths(searchPaths);
            // cc.log('JSON.stringify(searchPaths)', JSON.stringify(searchPaths))
            // restart game.
            setTimeout(() => {
                // cc.log('restart game')
                cc.game.restart();
            }, 500)
        }
    }

    hotUpdate() {
        // cc.log('hotUpdate', this.stringHost)
        if (this._am && !this._updating) {
            this._am.setEventCallback(this.updateCb.bind(this));

            this.loadCustomManifest(this.stringHost)

            this._am.update();
            this._updating = true;
        }
    }

    updateProcess(pc) {
        cc.log('Updated file: ' + pc);
        this.loadingSprite.fillRange = pc;
        this.loadingLabel.string = `Update ${Math.round(pc * 100)}%`
    }
}
