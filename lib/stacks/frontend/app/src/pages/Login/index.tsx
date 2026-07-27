// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { Authenticator } from "@aws-amplify/ui-react";

const Login = () => {
    return <Authenticator hideSignUp={true} variation="modal" />;
};

export default Login;
