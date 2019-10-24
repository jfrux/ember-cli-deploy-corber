/* eslint-env node */
'use strict';

const BasePlugin = require('ember-cli-deploy-plugin');
const Build = require('corber/lib/commands/build');
const glob = require("glob");
const getCordovaPath = require('corber/lib/targets/cordova/utils/get-path');
const { Promise } = require('rsvp');
const { dasherize } = require('ember-cli-string-utils');
const { copySync, readdirSync, remove } = require('fs-extra');
const path = require("path");
// path to cordova android build output folder relative to `corber/corodva` project folder
const ANDROID_APP_PATH = '/platforms/android/app/';
const ANDROID_BUILD_OUTPUT_PATH = path.join(ANDROID_APP_PATH,'/build/outputs/apk/');
function arr_diff (a1, a2) {

    var a = [], diff = [];

    for (var i = 0; i < a1.length; i++) {
        a[a1[i]] = true;
    }

    for (var i = 0; i < a2.length; i++) {
        if (a[a2[i]]) {
            delete a[a2[i]];
        } else {
            a[a2[i]] = true;
        }
    }

    for (var k in a) {
        diff.push(k);
    }

    return diff;
}

module.exports = {
  name: 'ember-cli-deploy-corber',

  createDeployPlugin: function(options) {
    let DeployPlugin = BasePlugin.extend({
      name: options.name,

      defaultConfig: {
        enabled: true,
        skipFrameworkBuild: true
      },

      setup: function(context) {
        return new Promise((resolve, reject) => {
          // Clear build output folder.
          // Since cordova does not provide any public api to retrieve build atrifacts, we retrieve them from content
          // in build output folder and therefore it must be empty.
          let buildOutputPath = this.getBuildOutputPath(context);

          if (!buildOutputPath) {
            // resolve immediately if build output path for this platform is unknown
            resolve();
          }

          remove(buildOutputPath, (err) => {
            if (err) {
              this.log(`Failed to clear build output at ${buildOutputPath}.`, { color: 'red' });
              this.log(err, { color: 'red' });
              reject();
            }

            resolve();
          });
        });
      },
      didBuild: function(context) {
        if (!this.readConfig('enabled')) {
          return;
        }

        return new Promise((resolve, reject) => {
          let cordovaAndroidWwwSrc = path.join(getCordovaPath(context.project),ANDROID_APP_PATH, "src/main/assets/www/");
          let cordovaOutputPath = getCordovaPath(context.project).concat('/www');
          let buildArgs = this.getBuildArgs();
          let buildOutputPath = this.getBuildOutputPath(context);
          let platform = this.readConfig('platform');

          // cordova requires web artifacts to be in cordova's `www` sub directory
          this.log(`Copying framework build to ${cordovaOutputPath}`, { verbose: true });
          copySync(context.distDir, cordovaOutputPath);

          // corber changes log level of context.ui passed in if called with `--quiet` flag
          // store current log level to reset it afterwards
          let logLevel = this.getLogLevel(context.ui);

          this.log(`Running: corber build ${buildArgs.join(' ')}`, { verbose: true });
          let build = new Build({
            ui: context.ui,
            project: context.project,
            settings: {}
          });
          return build.validateAndRun(buildArgs).then(() => {
            // reset log level which got changed by corber called with `--quiet` flag
            context.ui.setWriteLevel(logLevel);

            this.log('Corber build okay', { verbose: true });

            let buildArtifacts;
            if (buildOutputPath) {
              buildArtifacts = readdirSync(buildOutputPath).map((filename) => {
                return buildOutputPath.concat(filename);
              });
            }

            if (!Array.isArray(buildArtifacts) || buildArtifacts.length === 0) {
              this.log('Could not capture any build artifacts', { color: 'red' });
              resolve();
            }

            this.log(`Build artifacts: ${buildArtifacts.join(', ')}`, { verbose: true });

            // add build artifacts to context
            let additionalContext = {
              corber: {}
            };

            if (context.corber && Array.isArray(context.corber[platform])) {
              additionalContext.corber[platform] = context.corber[platform].concat(buildArtifacts);
            } else {
              additionalContext.corber[platform] = buildArtifacts;
            }

            // Copies new files back to dist for other plugins.
            copySync(cordovaAndroidWwwSrc,context.distDir);
            let newFiles = [].concat(glob.sync('**/*', { cwd: context.distDir, nodir: true, dot: true}));
            newFiles = arr_diff(context.distFiles, newFiles);
            additionalContext.distFiles = newFiles;
            resolve(additionalContext);
          }).catch(reject);
        });
      },

      getBuildArgs: function() {
        let ignoredOptions = ['enabled'];
        let pluginOptions = this.pluginConfig;

        let args = Object.keys(pluginOptions).filter(pluginOption => {
          return ignoredOptions.indexOf(pluginOption) === -1;
        }).map(pluginOption => {
          let value = this.readConfig(pluginOption);
          let arg = `--${dasherize(pluginOption)}`;

          if (value === true) {
            return arg;
          }

          return `${arg}=${value}`;
        });
        args.push('--add-cordova-js');
        args.push('--quiet');

        return args;
      },

      getBuildOutputPath: function(context) {
        const isRelease = this.readConfig('release');
        const platform = this.readConfig('platform');
        const projectPath = context.project;
        let cordovaPath = getCordovaPath(projectPath);
        let buildPath = path.join(ANDROID_BUILD_OUTPUT_PATH,(isRelease ? 'release/' : 'debug/'));
        switch (platform) {
          case 'android':
            return path.join(cordovaPath,buildPath);

          default:
            this.log('Adding build artifacts to ember-cli-build context is ' +
                     `not supported yet for platform ${platform}`, { color: 'red' });
            return;
        }
      },

      getLogLevel: function(ui) {
        // console-ui does not provide any public api to retrieve current log log level
        // guess it by wirteLevelVisible method
        let logLevels = [
          'DEBUG',
          'INFO',
          'WARNING',
          'ERROR'
        ];
        let currentLogLevel = logLevels.find((logLevel) => {
          return ui.writeLevelVisible(logLevel);
        });

        if (!currentLogLevel) {
          this.log('Could not guess current log level. Using ERROR as fallback.', { color: 'red' });
          return 'ERROR';
        }

        return currentLogLevel;
      }
    });

    return new DeployPlugin();
  }
};
