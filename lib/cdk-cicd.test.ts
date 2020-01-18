import {App, CfnParameter, SecretValue, Stack} from "@aws-cdk/core";
import {CdkCicd} from "./cdk-cicd";
import '@aws-cdk/assert/jest';
import {Artifact, IAction, Pipeline} from "@aws-cdk/aws-codepipeline";
import {CodeBuildAction, GitHubSourceAction} from "@aws-cdk/aws-codepipeline-actions";
import {PolicyStatement} from "@aws-cdk/aws-iam";

let mockAction: IAction;
let mockBuildSpec = {
    version: '0.2',
    phases: {},
    artifacts: {
        "secondary-artifacts": {
            cfn_template: {files: "template.yaml"}
        }
    },
};
let app: App;

function createStack() {
    app = new App();

    const stack = new Stack(app, 'test');
    new CdkCicd(stack, 'testing', {
        stackName: 'thing',
        sourceAction: (sourceArtifact) => {
            mockAction = new GitHubSourceAction({
                    actionName: "pull-from-github",
                    owner: "mbonig",
                    repo: "secure-bucket",
                    oauthToken: SecretValue.cfnParameter(new CfnParameter(stack, 'oauth-token', {noEcho: true})),
                    output: sourceArtifact
                }
            );
            return mockAction;
        },
        createBuildSpec: () => mockBuildSpec,
        additionalPolicyStatements: [new PolicyStatement({})]
    });
    return stack;
}

test('has a code pipeline', () => {
    const stack = createStack();
    expect(stack).toHaveResource("AWS::CodePipeline::Pipeline");
});

test('uses the provides source stage', () => {
    const stack = createStack();

    const construct = stack.node.findChild('testing');
    const codePipeline = <Pipeline>construct.node.findChild('testing-pipeline');
    expect(codePipeline.stages[0].actions[0]).toBe(mockAction);
});

test('throws error if undefined sourceAction function', () => {
    const app = new App();
    const stack = new Stack(app, 'test');

    try {

        new CdkCicd(stack, 'testing', {
            stackName: 'thing',
            // @ts-ignore TS2322
            // @ts-ignore TS6133
            sourceAction: (sourceArtifact) => {
                return undefined;
            },
            createBuildSpec: () => mockBuildSpec
        });
    } catch (err) {
        expect(err.message).toBe("Please provide a sourceAction that returns an IAction pointing at the source CDK module.");
    }

});

test("throws error if sourceAction doesn't use the artifact", () => {
    const app = new App();
    const stack = new Stack(app, 'test');

    try {

        new CdkCicd(stack, 'testing', {
            stackName: 'thing',
            // @ts-ignore TS2322
            // @ts-ignore TS6133
            sourceAction: (sourceArtifact) => {
                return new GitHubSourceAction({
                        actionName: "pull-from-github",
                        owner: "mbonig",
                        repo: "secure-bucket",
                        oauthToken: SecretValue.cfnParameter(new CfnParameter(stack, 'oauth-token', {noEcho: true})),
                        output: Artifact.artifact("not-source")
                    }
                );
            },
            createBuildSpec: () => mockBuildSpec
        });
        throw new Error("The expected exception wasn't thrown by the code.");
    } catch (err) {
        expect(err.message).toBe("Please provide a sourceAction that uses the provided sourceArtifact.");
    }

});

test('uses the provides buildSpec', () => {
    const stack = createStack();

    expect(stack).toHaveResource("AWS::CodeBuild::Project", {
        "Source": {
            "BuildSpec": JSON.stringify(mockBuildSpec, null, 2),
            "Type": "CODEPIPELINE"
        }
    });
});

test("Doesn't handle lambdas by default", () => {
    const stack = createStack();

    const construct = stack.node.findChild('testing');
    const codePipeline = <Pipeline>construct.node.findChild('testing-pipeline');
    expect(codePipeline.stages[2].actions.length).toBe(1);

    expect(stack).toHaveResource("AWS::CodeBuild::Project", {
        "Environment": {
            "ComputeType": "BUILD_GENERAL1_SMALL",
            "Image": "aws/codebuild/amazonlinux2-x86_64-standard:2.0",
            "PrivilegedMode": true,
            "Type": "LINUX_CONTAINER"
        }
    });
    // @ts-ignore
    let codeBuildAction = codePipeline.stages[1].actions[0] as CodeBuildAction;
    expect(codeBuildAction.actionProperties.outputs!.length).toBe(1);

});

test("adds lambda requirements ", () => {
    app = new App();

    const stack = new Stack(app, 'test');
    new CdkCicd(stack, 'testing', {
        hasLambdas: true,
        stackName: 'thing',
        sourceAction: (sourceArtifact) => {
            mockAction = new GitHubSourceAction({
                    actionName: "pull-from-github",
                    owner: "mbonig",
                    repo: "secure-bucket",
                    oauthToken: SecretValue.cfnParameter(new CfnParameter(stack, 'oauth-token', {noEcho: true})),
                    output: sourceArtifact
                }
            );
            return mockAction;
        },
        createBuildSpec: () => {
            return {
                version: '0.2',
                phases: {},
                artifacts: {
                    "secondary-artifacts": {
                        "cfn_template": {files: "template.yaml"},
                        "lambda_package": {files: ["*.zip"], "discard-paths": true}
                    }
                },
            };
        }
    });

    const construct = stack.node.findChild('testing');
    const codePipeline = <Pipeline>construct.node.findChild('testing-pipeline');
    expect(codePipeline.stages[2].actions.length).toBe(2);

    expect(stack).toHaveResource("AWS::CodeBuild::Project", {
        "Environment": {
            "ComputeType": "BUILD_GENERAL1_SMALL",
            "EnvironmentVariables": [
                {
                    "Name": "S3_LAMBDA_BUCKET",
                    "Type": "PLAINTEXT",
                    "Value": {
                        "Ref": "testingtestingartifactbucket7643106D"
                    }
                }
            ],
            "Image": "aws/codebuild/amazonlinux2-x86_64-standard:2.0",
            "PrivilegedMode": true,
            "Type": "LINUX_CONTAINER"
        }
    });

    let codeBuildAction = codePipeline.stages[1].actions[0] as CodeBuildAction;
    expect(codeBuildAction.actionProperties.outputs!.length).toBe(2);

});

test('adds provided additional role policies to the codebuild project', () => {
    // const stack = createStack();
    // I don't know how to test this right now...
    // expect(stack).toHaveResource("AWS::IAM::Policy", {"one": "two"});

});

test("throws error if buildspec doesn't properly have the cfn_template output artifacts", () => {
    app = new App();

    const stack = new Stack(app, 'test');
    try {
        new CdkCicd(stack, 'testing', {
            stackName: 'thing',
            sourceAction: (sourceArtifact) => {
                mockAction = new GitHubSourceAction({
                        actionName: "pull-from-github",
                        owner: "mbonig",
                        repo: "secure-bucket",
                        oauthToken: SecretValue.cfnParameter(new CfnParameter(stack, 'oauth-token', {noEcho: true})),
                        output: sourceArtifact
                    }
                );
                return mockAction;
            },
            createBuildSpec: () => {
                return {
                    version: '0.2',
                    phases: {},
                    artifacts: {
                        "secondary-artifacts": {}
                    },
                };
            },
            additionalPolicyStatements: [new PolicyStatement({})]
        });
        throw new Error("The expected exception didn't occur");
    } catch (err) {
        expect(err.message).toBe("Please provide a BuildSpec that has an .artifacts.secondary-artifacts.cfn_template value.");
    }
});

test("throws error if buildspec doesn't properly have the cfn_template output artifacts", () => {
    app = new App();

    const stack = new Stack(app, 'test');
    try {
        new CdkCicd(stack, 'testing', {
            stackName: 'thing',
            sourceAction: (sourceArtifact) => {
                mockAction = new GitHubSourceAction({
                        actionName: "pull-from-github",
                        owner: "mbonig",
                        repo: "secure-bucket",
                        oauthToken: SecretValue.cfnParameter(new CfnParameter(stack, 'oauth-token', {noEcho: true})),
                        output: sourceArtifact
                    }
                );
                return mockAction;
            },
            createBuildSpec: () => {
                return {
                    version: '0.2',
                    phases: {},
                    artifacts: {
                        "secondary-artifacts": {
                            cfn_template: {}
                        }
                    },
                };
            },
            additionalPolicyStatements: [new PolicyStatement({})]
        });
        throw new Error("The expected exception didn't occur");
    } catch (err) {
        expect(err.message).toBe("Please provide a BuildSpec that has an .artifacts.secondary-artifacts.cfn_template.files value.");
    }
});

test("throws error if buildspec doesn't properly have the secondary artifacts", () => {
    app = new App();

    const stack = new Stack(app, 'test');
    try {
        new CdkCicd(stack, 'testing', {
            stackName: 'thing',
            sourceAction: (sourceArtifact) => {
                mockAction = new GitHubSourceAction({
                        actionName: "pull-from-github",
                        owner: "mbonig",
                        repo: "secure-bucket",
                        oauthToken: SecretValue.cfnParameter(new CfnParameter(stack, 'oauth-token', {noEcho: true})),
                        output: sourceArtifact
                    }
                );
                return mockAction;
            },
            createBuildSpec: () => {
                return {
                    version: '0.2',
                    phases: {},
                    artifacts: {},
                };
            },
            additionalPolicyStatements: [new PolicyStatement({})]
        });
        throw new Error("The expected exception didn't occur");
    } catch (err) {
        expect(err.message).toBe("Please provide a BuildSpec that has an .artifacts.secondary-artifacts value.");
    }
});

test("throws error if buildspec doesn't properly have the lambda artifacts", () => {
    app = new App();

    const stack = new Stack(app, 'test');
    try {
        new CdkCicd(stack, 'testing', {
            stackName: 'thing',
            sourceAction: (sourceArtifact) => {
                mockAction = new GitHubSourceAction({
                        actionName: "pull-from-github",
                        owner: "mbonig",
                        repo: "secure-bucket",
                        oauthToken: SecretValue.cfnParameter(new CfnParameter(stack, 'oauth-token', {noEcho: true})),
                        output: sourceArtifact
                    }
                );
                return mockAction;
            },
            createBuildSpec: () => {
                return {
                    version: '0.2',
                    phases: {},
                    artifacts: {
                        "secondary-artifacts": {
                            "cfn_template": {files: "template.yaml"}
                        }
                    },
                };
            },
            hasLambdas: true,
            additionalPolicyStatements: [new PolicyStatement({})]
        });
        throw new Error("The expected exception didn't occur");
    } catch (err) {
        expect(err.message).toBe("Please provide a BuildSpec that has an .artifacts.secondary-artifacts.lambda_package value when hasLambdas is true.");
    }
});

test("throws error if buildspec doesn't properly have the lambda artifacts files", () => {
    app = new App();

    const stack = new Stack(app, 'test');
    try {
        new CdkCicd(stack, 'testing', {
            stackName: 'thing',
            sourceAction: (sourceArtifact) => {
                mockAction = new GitHubSourceAction({
                        actionName: "pull-from-github",
                        owner: "mbonig",
                        repo: "secure-bucket",
                        oauthToken: SecretValue.cfnParameter(new CfnParameter(stack, 'oauth-token', {noEcho: true})),
                        output: sourceArtifact
                    }
                );
                return mockAction;
            },
            createBuildSpec: () => {
                return {
                    version: '0.2',
                    phases: {},
                    artifacts: {
                        "secondary-artifacts": {
                            "cfn_template": {files: "template.yaml"},
                            "lambda_package": {}
                        }
                    },
                };
            },
            hasLambdas: true,
            additionalPolicyStatements: [new PolicyStatement({})]
        });
        throw new Error("The expected exception didn't occur");
    } catch (err) {
        expect(err.message).toBe("Please provide a BuildSpec that has an .artifacts.secondary-artifacts.lambda_package.files value when hasLambdas is true.");
    }
});
