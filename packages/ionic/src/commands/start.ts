import * as path from 'path';

import chalk from 'chalk';

import { validators } from '@ionic/cli-framework/lib';
import { BACKEND_LEGACY, BACKEND_PRO, CommandLineInputs, CommandLineOptions, CommandPreRun } from '@ionic/cli-utils';
import { Command, CommandMetadata } from '@ionic/cli-utils/lib/command';
import { FatalException } from '@ionic/cli-utils/lib/errors';
import { fsMkdir, fsUnlink, pathExists, removeDirectory } from '@ionic/cli-framework/utils/fs';
import { PROJECT_FILE, Project } from '@ionic/cli-utils/lib/project';
import { emoji } from '@ionic/cli-utils/lib/utils/emoji';

@CommandMetadata({
  name: 'start',
  type: 'global',
  description: 'Create a new project',
  longDescription: `
This command creates a working Ionic app. It installs dependencies for you and sets up your project.

${chalk.green('ionic start')} will create an app from a template. You can list all templates with the ${chalk.green('--list')} option.

See the CLI documentation on starters: ${chalk.bold('https://ionicframework.com/docs/cli/starters.html')}
`,
  exampleCommands: [
    '',
    '--list',
    'myApp blank',
    // 'myApp tabs --cordova',
    'myApp blank --type=ionic1',
  ],
  inputs: [
    {
      name: 'name',
      description: 'The name of your project directory',
    },
    {
      name: 'template',
      description: `The starter template to use (e.g. ${['blank', 'tabs'].map(t => chalk.green(t)).join(', ')}; use ${chalk.green('--list')} to see all)`,
    }
  ],
  options: [
    {
      name: 'list',
      description: 'List starter templates available',
      type: Boolean,
      aliases: ['l'],
    },
    {
      name: 'type',
      description: `Type of project to start (e.g. ${chalk.green('ionic-angular')}, ${chalk.green('ionic1')})`,
      type: String,
      default: 'ionic-angular',
    },
    {
      name: 'app-name',
      description: 'Human-readable name (use quotes around the name)',
      type: String,
      aliases: ['n'],
    },
    // {
    //   name: 'cordova',
    //   description: 'Include Cordova integration',
    //   type: Boolean,
    // },
    {
      name: 'deps',
      description: 'Do not install npm/yarn dependencies',
      type: Boolean,
      default: true,
      advanced: true,
    },
    {
      name: 'git',
      description: 'Do not initialize a git repo',
      backends: [BACKEND_LEGACY],
      type: Boolean,
      default: true,
      advanced: true,
    },
    {
      name: 'link',
      description: 'Do not ask to connect the app with the Ionic Dashboard',
      type: Boolean,
      default: true,
      advanced: true,
    },
    {
      name: 'pro-id',
      description: 'Specify an app ID from the Ionic Dashboard to link',
    },
  ],
})
export class StartCommand extends Command implements CommandPreRun {
  async preRun(inputs: CommandLineInputs, options: CommandLineOptions): Promise<void> {
    const { STARTER_TEMPLATES, getStarterTemplateTextList } = await import('@ionic/cli-utils/lib/start');
    const { promptToLogin } = await import('@ionic/cli-utils/lib/session');

    // If the action is list then lets just end here.
    if (options['list']) {
      this.env.log.msg(getStarterTemplateTextList(STARTER_TEMPLATES).join('\n'));
      throw new FatalException('', 0);
    }

    if (options['skip-deps']) {
      this.env.log.warn(`The ${chalk.green('--skip-deps')} option has been deprecated. Please use ${chalk.green('--no-deps')}.`);
      options['deps'] = false;
    }

    if (options['skip-link']) {
      this.env.log.warn(`The ${chalk.green('--skip-link')} option has been deprecated. Please use ${chalk.green('--no-link')}.`);
      options['link'] = false;
    }

    if (options['pro-id']) {
      options['link'] = true;
    }

    const proAppId = <string>options['pro-id'] || '';
    const config = await this.env.config.load();

    if (proAppId && config.backend !== BACKEND_PRO) {
      await this.env.runCommand(['config', 'set', '-g', 'backend', 'pro'], {});
      this.env.log.nl();
      this.env.log.info(
        `${chalk.bold(chalk.blue.underline('Welcome to Ionic Pro!') + ' The CLI is now set up to use Ionic Pro services.')}\n` +
        `You can revert back to Ionic Cloud (legacy) services at any time:\n\n` +
        `${chalk.green('ionic config set -g backend legacy')}\n`
      );
    }

    if (this.env.project.directory) {
      const confirm = await this.env.prompt({
        type: 'confirm',
        name: 'confirm',
        message: 'You are already in an Ionic project directory. Do you really want to start another project here?',
        default: false,
      });

      if (!confirm) {
        this.env.log.info('Not starting project within existing project.');
        throw new FatalException();
      }
    }

    if (options['v1'] || options['v2']) {
      const type = options['v1'] ? 'ionic1' : 'ionic-angular';

      throw new FatalException(
        `Sorry! The ${chalk.green('--v1')} and ${chalk.green('--v2')} flags have been removed.\n` +
        `Use the ${chalk.green('--type')} option. (${chalk.green('ionic start --help')})\n\n` +
        `For ${chalk.bold(this.env.project.formatType(type))} projects, try ${chalk.green('ionic start ' + (inputs.length > 0 ? inputs.join(' ') + ' ' : '') + '--type=' + type)}`
      );
    }

    if (proAppId) {
      if (!(await this.env.session.isLoggedIn())) {
        await promptToLogin(this.env);
      }
    }

    if (!inputs[0]) {
      if (proAppId) {
        const { App } = await import('@ionic/cli-utils/lib/app');
        const token = await this.env.session.getUserToken();
        const appLoader = new App(token, this.env.client);
        const app = await appLoader.load(proAppId);
        this.env.log.info(`Using ${chalk.bold(app.slug)} for ${chalk.green('name')}.`);
        inputs[0] = app.slug;
      } else {
        const name = await this.env.prompt({
          type: 'input',
          name: 'name',
          message: 'What would you like to name your project:',
          validate: v => validators.required(v, 'name'),
        });

        inputs[0] = name;
      }
    }

    if (!inputs[1]) {
      const template = await this.env.prompt({
        type: 'list',
        name: 'template',
        message: 'What starter would you like to use:',
        choices: () => {
          const starterTemplates = STARTER_TEMPLATES.filter(st => st.type === options['type']);

          return getStarterTemplateTextList(starterTemplates)
            .map((text: string, index: number) => {
              return {
                name: text,
                short: starterTemplates[index].name,
                value: starterTemplates[index].name
              };
            });
        }
      });

      inputs[1] = template;
    }
  }

  async run(inputs: CommandLineInputs, options: CommandLineOptions): Promise<void> {
    const {
      STARTER_BASE,
      STARTER_TEMPLATES,
      getHelloText,
      getStarterList,
      isProjectNameValid,
      isSafeToCreateProjectIn,
      readStarterManifest,
      updatePackageJsonForCli,
    } = await import('@ionic/cli-utils/lib/start');

    const { isValidPackageName } = await import('@ionic/cli-framework/utils/npm');
    const { pkgManagerArgs } = await import('@ionic/cli-utils/lib/utils/npm');
    const { download } = await import('@ionic/cli-utils/lib/http');
    const { createTarExtraction } = await import('@ionic/cli-utils/lib/utils/archive');
    const { prettyPath } = await import('@ionic/cli-utils/lib/utils/format');

    let [ projectName, starterTemplateName ] = inputs;
    let appName = options['app-name'] ? String(options['app-name']) : projectName;
    let gitIntegration = false;
    const proAppId = options['pro-id'] ? String(options['pro-id']) : undefined;
    let linkConfirmed = typeof proAppId === 'string';

    const config = await this.env.config.load();

    if (!isProjectNameValid(projectName)) {
      throw new FatalException(`Please name your Ionic project something meaningful other than ${chalk.green(projectName)}`);
    }

    if (config.backend === BACKEND_PRO || options['git']) {
      const cmdInstalled = await this.env.shell.cmdinfo('git', ['--version']);

      if (cmdInstalled) {
        gitIntegration = true;
      } else {
        if (config.backend === BACKEND_LEGACY) {
          this.env.log.warn(
            `Git CLI not found on your PATH. You may wish to install it to version control your app.\n` +
            `See installation docs for git: ${chalk.bold('https://git-scm.com/book/en/v2/Getting-Started-Installing-Git')}\n\n` +
            `Use ${chalk.green('--no-git')} to disable this warning.\n`
          );
        }
      }
    }

    let starterTemplate = STARTER_TEMPLATES.find(t => t.type === options['type'] && t.name === starterTemplateName);

    if (!starterTemplate) {
      this.env.tasks.next('Looking up starter...');
      const starterList = await getStarterList(this.env.config);

      const starter = starterList.starters.find(t => t.type === options['type'] && t.name === starterTemplateName);

      if (starter) {
        starterTemplate = { strip: false, name: starter.name, type: starter.type, description: '', archive: `${STARTER_BASE}/${starter.id}.tar.gz` };
      } else {
        throw new FatalException(`Unable to find starter template for ${chalk.green(starterTemplateName)}`);
      }
    }

    const projectRoot = path.resolve(projectName);
    projectName = path.basename(projectRoot);

    if (!isValidPackageName(projectName)) {
      appName = 'MyApp';
      this.env.log.warn(`${chalk.green(projectName)} was not a valid name for ${chalk.bold('package.json')}. Using ${chalk.bold(appName)} for now.`);
    }

    const shellOptions = { cwd: projectRoot };
    const projectExists = await pathExists(projectName);

    // Create the project directory
    if (!projectExists) {
      this.env.tasks.next(`Creating directory ${chalk.green(prettyPath(projectRoot))}`);
      await fsMkdir(projectRoot, undefined);
    } else if (!(await isSafeToCreateProjectIn(projectRoot))) {
      const confirm = await this.env.prompt({
        type: 'confirm',
        name: 'confirm',
        message: (
          `The directory ${chalk.green(projectName)} contains file(s) that could conflict. ` +
          'Would you like to overwrite the directory with this new project?'
        ),
        default: false,
      });

      if (confirm) {
        this.env.tasks.next(`Creating directory ${chalk.green(prettyPath(projectRoot))}`);
        await removeDirectory(projectRoot);
        await fsMkdir(projectRoot, undefined);
      } else {
        this.env.log.info(`Not erasing existing project in ${chalk.green(prettyPath(projectRoot))}.`);
        return;
      }
    }

    const task = this.env.tasks.next(`Downloading & extracting starter template ${chalk.green(starterTemplateName.toString())}`);
    const ws = await createTarExtraction({ cwd: projectRoot, strip: starterTemplate.strip ? 1 : 0 });
    await download(this.env.config, starterTemplate.archive, ws, {
      progress: (loaded, total) => task.progress(loaded, total),
    });

    // start is weird, once the project directory is created, it becomes a
    // "project" command and so we replace the `Project` instance that was
    // autogenerated when the CLI booted up. This has worked thus far?
    this.env.project = new Project(projectRoot, PROJECT_FILE);

    this.env.tasks.next(`Updating ${chalk.bold('package.json')} with app details`);

    await updatePackageJsonForCli(projectRoot, appName);

    this.env.tasks.end();

    if (options['deps']) {
      this.env.log.info('Installing dependencies may take several minutes.');

      this.env.log.msg('\n');
      this.env.log.msg(chalk.bold(`  ${emoji('✨', '*')}   IONIC  DEVAPP  ${emoji('✨', '*')}`));

      this.env.log.msg('\n Speed up development with the ' + chalk.bold('Ionic DevApp') +
      ', our fast, on-device testing mobile app\n\n');
      this.env.log.msg(`  -  ${emoji('🔑', '')}   Test on iOS and Android without Native SDKs`);
      this.env.log.msg(`  -  ${emoji('🚀', '')}   LiveReload for instant style and JS updates`);

      this.env.log.msg('\n ️-->    Install DevApp: ' + chalk.bold('https://bit.ly/ionic-dev-app') + '    <--\n\n');

      const [ installer, ...installerArgs ] = await pkgManagerArgs(this.env, { command: 'install' });
      await this.env.shell.run(installer, installerArgs, shellOptions);
    }

    if (config.backend === BACKEND_PRO && !gitIntegration) {
      throw new FatalException(
        `Git CLI not found on your PATH. It must be installed to connect this app to Ionic.\n` +
        `See installation docs for git: ${chalk.bold('https://git-scm.com/book/en/v2/Getting-Started-Installing-Git')}`
      );
    }

    if (gitIntegration) {
      await this.env.shell.run('git', ['init'], { showSpinner: false, ...shellOptions });
    }

    if (config.backend === BACKEND_PRO) {
      if (options['link'] && !linkConfirmed) {
        this.env.log.msg('\n' + chalk.bold(`  ${emoji('🔥', '*')}   IONIC  PRO  ${emoji('🔥', '*')}`));
        this.env.log.msg('\n Supercharge your Ionic development with the ' + chalk.bold('Ionic Pro') + ' SDK\n\n');
        this.env.log.msg(`  -  ${emoji('⚠️', '')}   Track runtime errors in real-time, back to your original TypeScript`);
        this.env.log.msg(`  -  ${emoji('📲', '')}   Push remote updates and skip the app store queue`);
        this.env.log.msg(`\nLearn more about Ionic Pro: ${chalk.bold('https://ionicframework.com/products')}\n`);

        const confirm = await this.env.prompt({
          type: 'confirm',
          name: 'confirm',
          message: 'Install the free Ionic Pro SDK and connect your app?',
          noninteractiveValue: false,
        });
        console.log('\n-----------------------------------\n');

        if (confirm) {
          linkConfirmed = true;
        }
      }

      if (linkConfirmed) {
        const [ installer, ...installerArgs ] = await pkgManagerArgs(this.env, { pkg: '@ionic/pro' });
        await this.env.shell.run(installer, installerArgs, shellOptions);

        const cmdArgs = ['link'];

        if (proAppId) {
          cmdArgs.push(proAppId);
        }

        await this.env.runCommand(cmdArgs);
      }
    }

    const manifestPath = path.resolve(projectRoot, 'ionic.starter.json');
    const manifest = await readStarterManifest(manifestPath);
    await fsUnlink(manifestPath);

    if (gitIntegration) {
      await this.env.shell.run('git', ['add', '-A'], { showSpinner: false, ...shellOptions });
      await this.env.shell.run('git', ['commit', '-m', 'Initial commit', '--no-gpg-sign'], { showSpinner: false, ...shellOptions });
    }

    if (config.backend === BACKEND_LEGACY) {
      // Print out hello text about how to get started
      if (this.env.log.shouldLog('info')) {
        this.env.log.msg(getHelloText());
      }
    }

    this.env.log.nl();

    if (manifest.welcome) {
      this.env.log.msg(`${chalk.bold('Starter Welcome')}:\n`);
      this.env.log.info(manifest.welcome);
    }

    this.env.log.msg(`${chalk.bold('Next Steps')}:\n`);
    this.env.log.msg(`* Go to your newly created project: ${chalk.green(`cd ${prettyPath(projectRoot)}`)}`);
    this.env.log.msg(`* Get Ionic DevApp for easy device testing: ${chalk.bold('https://bit.ly/ionic-dev-app')}`);

    if (config.backend === BACKEND_PRO && linkConfirmed) {
      this.env.log.msg(`* Finish setting up Ionic Pro Error Monitoring: ${chalk.bold('https://ionicframework.com/docs/pro/monitoring/#getting-started')}\n`);
      this.env.log.msg(`* Finally, push your code to Ionic Pro to perform real-time updates, and more: ${chalk.green('git push ionic master')}`);
    }

    this.env.log.nl();
  }
}
